// Each value N explicitly joins stage N to stage N+1. An empty array means
// no joins; missing data retains the stage-table inference of older backups.
export function getContinuousStageGroups(stages, weeklyHours, settings, continuousLinks) {
  const groups = [[1]];
  for (let stage = 2; stage <= weeklyHours; stage += 1) {
    const linked = Array.isArray(continuousLinks)
      ? continuousLinks.includes(stage - 1)
      : Object.entries(settings.periodsByDay).some(([day, periods]) => {
        for (let period = 1; period < periods; period += 1) {
          if (stages[`${day}-${period}`] === stage - 1 && stages[`${day}-${period + 1}`] === stage) return true;
        }
        return false;
      });
    if (linked) groups[groups.length - 1].push(stage);
    else groups.push([stage]);
  }
  return groups;
}
