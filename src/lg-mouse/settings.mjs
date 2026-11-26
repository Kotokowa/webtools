export function numberOptions(values) {
  return [...new Set((values ?? []).filter(value => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
}

export function profileChanges(profile, edits, dpiOptions) {
  if (!profile.crcValid) throw new Error('板载配置校验未通过，未写入。');
  const values = { sector: profile.sector };
  if (edits.stages) {
    const stages = profile.dpiStages.map((stage, index) => ({ ...stage, ...edits.stages[index] }));
    const defaultIndex = edits.defaultIndex;
    if (defaultIndex !== profile.defaultDpiIndex || stages.some((stage, index) => stage.x !== profile.dpiStages[index].x || stage.y !== profile.dpiStages[index].y)) {
      if (!Number.isInteger(defaultIndex) || defaultIndex < 0 || defaultIndex >= stages.length ||
          stages.some(stage => !dpiOptions.includes(stage.x) || !dpiOptions.includes(stage.y))) {
        throw new Error('DPI 档位超出了该设备的可选范围，未写入。');
      }
      values.dpiStages = { stages, defaultIndex };
    }
  }
  const buttonAssignments = (edits.buttons ?? []).filter(({ button, binding }) =>
    profile.buttonAssignments.some(entry => entry.button === button && entry.action !== binding)
  ).map(({ button, binding }) => ({ layer: 'primary', button, binding }));
  if (buttonAssignments.length) values.buttonAssignments = buttonAssignments;
  return Object.keys(values).length > 1 ? values : null;
}

export function verifyProfile(profile, changes) {
  if (!profile?.crcValid || profile.sector !== changes.sector) return false;
  if (changes.dpiStages) {
    const { stages, defaultIndex } = changes.dpiStages;
    if (profile.defaultDpiIndex !== defaultIndex || profile.dpiStages.length !== stages.length ||
        !stages.every((stage, index) => profile.dpiStages[index].x === stage.x && profile.dpiStages[index].y === stage.y)) return false;
  }
  return (changes.buttonAssignments ?? []).every(({ button, binding }) =>
    profile.buttonAssignments.some(entry => entry.button === button && entry.action === binding));
}
