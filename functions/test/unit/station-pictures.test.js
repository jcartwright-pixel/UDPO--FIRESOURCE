const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Joe 10/12: each Plant Station tab shows its own work (a tote on Tote unloading, a case on Case unloading, a case going
// into the cooler on Returns, a pressure washer on Washing). The tanker picture belongs only on tanker screens.
const PUBLIC = path.join(__dirname, '../../../public');
const html = fs.readFileSync(path.join(PUBLIC, 'plant-station.html'), 'utf8');
const VIEWS = new Function('return ' + html.match(/const VIEWS = (\{[\s\S]*?\n {4}\});/)[1])();
const STATIONS = new Function('return ' + html.match(/const STATIONS = (\[[\s\S]*?\n {4}\]);/)[1])();
const OWN = { CASE: 'case-v1.webp', TOTES: 'tote-v1.webp', BOXING: 'box-v1.webp' };

test('every Plant Station tab shows a picture of its own work, never the tanker', () => {
  for (const st of STATIONS) {
    for (const v of st.views) {
      const pic = typeof VIEWS[v].pic === 'string' ? VIEWS[v].pic : VIEWS[v].pic[st.area];
      assert.ok(pic && fs.existsSync(path.join(PUBLIC, 'img/library', pic)), st.id + ' ' + v + ' has a picture');
      assert.doesNotMatch(pic, /tanker/, st.id + ' ' + v + ' is not a tanker screen');
      if ((v === 'loading' || v === 'unloading') && OWN[st.area]) assert.equal(pic, OWN[st.area], st.id + ' ' + v);
    }
  }
  assert.equal(VIEWS.returns.pic, 'case-returns-v1.webp');
  assert.equal(VIEWS.washing.pic, 'pressure-washer-v1.webp');
});

test('the Unloading and Returns screen titles show a case, not the tanker', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
  assert.match(app, /'unloading\.html': 'case-v1\.webp'/);
  assert.match(app, /'returns\.html': 'case-returns-v1\.webp'/);
});
