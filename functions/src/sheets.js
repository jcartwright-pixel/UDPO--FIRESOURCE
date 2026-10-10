/*
 * United Dairy Distribution app: reading Google Sheets.
 *
 * Read-only: the server asks Google only for the "spreadsheets.readonly" permission, so even a mistake in this
 * program cannot change a sheet. The server's service account must be given Viewer access to each sheet.
 */
'use strict';

const { GoogleAuth } = require('google-auth-library');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function makeSheetsReader(options) {
  const auth = (options && options.auth) || new GoogleAuth({ scopes: [SCOPE] });
  return {
    // One request per spreadsheet, however many tabs. Returns one 2-D array of cell texts per range.
    async batchGet(spreadsheetId, ranges) {
      const client = await auth.getClient();
      const query = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&') + '&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
      const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + '/values:batchGet?' + query;
      const res = await client.request({ url, method: 'GET' });
      const valueRanges = (res.data && res.data.valueRanges) || [];
      if (valueRanges.length !== ranges.length) throw new Error('Sheets returned ' + valueRanges.length + ' ranges, expected ' + ranges.length);
      return valueRanges.map(v => v.values || []);
    }
  };
}

const WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Only the write-back uses this, and only for the sandbox Live workbook (writeback.js refuses production IDs).
function makeSheetsWriter(options) {
  const auth = (options && options.auth) || new GoogleAuth({ scopes: [WRITE_SCOPE] });
  const reader = makeSheetsReader({ auth });
  return {
    batchGet: reader.batchGet,
    // Every changed cell of one tab in one request. RAW: text stays text, numbers stay numbers, nothing is re-read as a formula.
    async batchUpdate(spreadsheetId, data) {
      const client = await auth.getClient();
      await client.request({
        url: 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + '/values:batchUpdate',
        method: 'POST',
        data: { valueInputOption: 'RAW', data }
      });
    }
  };
}

module.exports = { makeSheetsReader, makeSheetsWriter, SCOPE, WRITE_SCOPE };
