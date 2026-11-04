/*
 * Departments (Joe 11-4-26: "employee department should have standard drop-down for departments ... we need to
 * standardize everything"). At Fairmont the dock workers were sitting under the drivers; DOCK is its own department now.
 *
 * The one list of departments a person can be in. Every screen that shows or picks a person's department uses this list
 * (a drop-down that starts blank), and the server takes nothing that is not on it. Shared by the screens and the server
 * (one file, copied unchanged to public/js/departments.js by npm run sync-logic; a unit test checks the two match).
 *
 *   DEPARTMENTS   the list, in the order the drop-down shows it, ALL CAPS
 *   clean(v)      a typed name onto the list ("Dock Worker" -> DOCK, "drivers" -> DRIVER), or '' when it is not one
 *   guess(job)    the department a job title from UDMS points to ("Dock Worker" -> DOCK, "CDL Driver" -> DRIVER), or ''
 *
 * UDMS keeps only a job title (position). Operations keeps the department: guessed from the job title until someone picks
 * one by hand on Administration > Employees; a department picked by hand is kept from then on, whatever UDMS says.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDDepartments = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEPARTMENTS = ['DRIVER', 'DOCK', 'LOADOUT', 'DISPATCH', 'GARAGE', 'PRODUCTION', 'DEBAG / LABELING', 'SANITATION', 'QUALITY / LAB',
    'PLANT MAINTENANCE', 'SHIPPING & RECEIVING', 'OFFICE', 'SALES', 'MANAGEMENT'];

  // Words in a job title or a typed department, and the department they mean. The first that matches wins, so the narrow
  // ones come first: "Dock Driver" is a dock worker (Joe: dock workers are not drivers), "Garage Mechanic" is the garage.
  var WORDS = [
    [/\bdock/, 'DOCK'],
    [/\bdispatch/, 'DISPATCH'],
    [/\bgarage|\bfleet|\bshop tech|\btire|\bdiesel/, 'GARAGE'],
    [/\bsanit|\bcip\b|\bcase wash|\bwash/, 'SANITATION'],
    [/\blab\b|\blab |\bquality|\bq\.?a\b|\bq\.?c\b/, 'QUALITY / LAB'],
    [/\bdebag|\blabel/, 'DEBAG / LABELING'],
    [/\bmaint|\bmechanic|\brefrig|\butilit|\belectric/, 'PLANT MAINTENANCE'],
    [/\bship|\breceiv|\binventory|\bwarehouse/, 'SHIPPING & RECEIVING'],
    [/\bload|\bcheck(er)?\b|\bcooler|\bfork|\bpalleti|\bpuller/, 'LOADOUT'],
    [/\bdriver|\bdriving|\bcdl\b|\broute|\bdelivery|\bhaul/, 'DRIVER'],
    [/\bfill|\bhtst|\bprocess|\bblow ?mold|\bboxing|\btote|\bproduction|\boperator|\bsilo|\bpasteur/, 'PRODUCTION'],
    [/\bsales|\baccount rep|\bmerchand/, 'SALES'],
    [/\bmanag|\bsupervis|\bdirector|\bforeman|\blead\b|\bsuperintend|\bpresident|\bowner/, 'MANAGEMENT'],
    [/\boffice|\bclerk|\badmin|\baccount|\bpayroll|\bhr\b|\bhuman res|\breception|\bbilling|\bsecretar/, 'OFFICE']
  ];

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function norm(v) { return text(v).toLowerCase().replace(/\s+/g, ' '); }

  // A name already on the list (any case, & or AND, with or without the slash part) is that department.
  function exact(v) {
    var k = norm(v).replace(/\band\b/g, '&').replace(/\s*\/\s*/g, ' / ');
    if (!k) return '';
    for (var i = 0; i < DEPARTMENTS.length; i++) {
      var d = DEPARTMENTS[i].toLowerCase();
      if (k === d || k === d.split(' / ')[0] || k === d + 's' || k + 's' === d) return DEPARTMENTS[i];
    }
    return '';
  }

  function byWords(v) {
    var k = ' ' + norm(v) + ' ';
    if (!text(v)) return '';
    for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(k)) return WORDS[i][1];
    return '';
  }

  // A typed department (an old typed value, an upload): the list's own name, or the one its words mean, or ''.
  function clean(v) { return exact(v) || byWords(v); }
  // A UDMS job title: the department it points to, or '' (the drop-down then starts blank).
  function guess(job) { return clean(job); }
  function isDepartment(v) { return DEPARTMENTS.indexOf(text(v)) >= 0; }

  return { DEPARTMENTS: DEPARTMENTS, clean: clean, guess: guess, isDepartment: isDepartment };
});
