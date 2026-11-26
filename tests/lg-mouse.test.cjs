const { test } = require('node:test');
const assert = require('node:assert/strict');
const { profileChanges, verifyProfile, numberOptions } = require('../src/lg-mouse/settings.mjs');

const profile = {
  sector: 2, crcValid: true, defaultDpiIndex: 0,
  dpiStages: [{ x: 800, y: 800, lod: 1 }, { x: 1600, y: 1600, lod: 2 }],
  buttonAssignments: [{ button: 3, action: 'Back' }, { button: 4, action: 'Custom' }]
};
const options = [400, 800, 1600];

test('filters invalid and duplicate values advertised by the device', () => {
  assert.deepEqual(numberOptions([1600, null, 400, 400, 0, NaN, '800']), [400, 1600]);
});

test('untouched fields and custom button bindings do not become flash writes', () => {
  assert.equal(profileChanges(profile, { stages: profile.dpiStages, defaultIndex: 0,
    buttons: [{ button: 3, binding: 'Back' }, { button: 4, binding: 'Custom' }] }, options), null);
});

test('preserves LOD, emits only changed button bindings, and verifies readback', () => {
  const changes = profileChanges(profile, { stages: [{ x: 400, y: 400 }], defaultIndex: 1,
    buttons: [{ button: 3, binding: 'Forward' }, { button: 4, binding: 'Custom' }] }, options);
  assert.deepEqual(changes, { sector: 2, dpiStages: { stages: [{ x: 400, y: 400, lod: 1 }, profile.dpiStages[1]], defaultIndex: 1 },
    buttonAssignments: [{ layer: 'primary', button: 3, binding: 'Forward' }] });
  assert.equal(verifyProfile(profile, changes), false);
  const confirmed = { ...profile, defaultDpiIndex: 1, dpiStages: changes.dpiStages.stages,
    buttonAssignments: [{ button: 3, action: 'Forward' }, profile.buttonAssignments[1]] };
  assert.equal(verifyProfile(confirmed, changes), true);
  assert.equal(verifyProfile({ ...confirmed, crcValid: false }, changes), false);
});

test('rejects corrupt sectors and unsupported DPI without proposing a write', () => {
  assert.throws(() => profileChanges({ ...profile, crcValid: false }, {}, options), /校验/);
  assert.throws(() => profileChanges(profile, { stages: [{ x: 1234 }], defaultIndex: 0 }, options), /可选范围/);
});
