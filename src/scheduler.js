const dayLabels = {
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
};

function createDefaultDetailStages(item, settings) {
  const stages = {};
  const classCount = Math.max(item.classNumbers?.length || 0, 1);
  const weeklyHours = Number(item.weeklyHours || 0);
  let availableIndex = 0;

  if (item.continuous && weeklyHours > 1) {
    let groupCount = 0;

    Object.keys(dayLabels).forEach((day) => {
      let period = 1;
      while (period <= settings.periodsByDay[day] && groupCount < classCount) {
        const groupPeriods = Array.from({ length: weeklyHours }, (_, index) => period + index);
        const canUseGroup = groupPeriods.every(
          (groupPeriod) =>
            groupPeriod <= settings.periodsByDay[day] &&
            (item.availableSlots?.[day] || []).includes(groupPeriod)
        );

        if (canUseGroup) {
          groupPeriods.forEach((groupPeriod, index) => {
            stages[createSlotKey(day, groupPeriod)] = index + 1;
          });
          groupCount += 1;
          period += weeklyHours;
        } else {
          period += 1;
        }
      }
    });

    return stages;
  }

  Object.keys(dayLabels).forEach((day) => {
    Array.from({ length: settings.periodsByDay[day] }, (_, index) => index + 1).forEach((period) => {
      if (!(item.availableSlots?.[day] || []).includes(period)) return;

      const stage = Math.floor(availableIndex / classCount) + 1;
      if (stage <= weeklyHours) {
        stages[createSlotKey(day, period)] = stage;
      }
      availableIndex += 1;
    });
  });

  return stages;
}

function hasEnoughContinuousChains(stages, item, settings) {
  const classCount = item.classNumbers?.length || 0;
  const weeklyHours = Number(item.weeklyHours || 0);
  if (!item.continuous || weeklyHours <= 1) return true;

  let chainCount = 0;

  Object.keys(dayLabels).forEach((day) => {
    for (let period = 1; period <= settings.periodsByDay[day]; period += 1) {
      const hasChain = Array.from({ length: weeklyHours }, (_, index) => period + index).every(
        (chainPeriod, index) =>
          chainPeriod <= settings.periodsByDay[day] &&
          stages[createSlotKey(day, chainPeriod)] === index + 1
      );

      if (hasChain) chainCount += 1;
    }
  });

  return chainCount >= classCount;
}

function createSlotKey(day, period) {
  return `${day}-${period}`;
}

function formatSlotKey(slotKey) {
  const [day, period] = slotKey.split('-');
  return `${dayLabels[day]}요일 ${period}교시`;
}

function countAvailableSlots(slots) {
  if (!slots) return 0;
  return Object.values(slots).reduce((sum, periods) => sum + periods.length, 0);
}

function formatDateTime(value) {
  if (!value) return '없음';
  return new Date(value).toLocaleString('ko-KR');
}

function generateWeeklySchedule(plan, detailItems, settings, onProgress = () => {}) {
  onProgress({
    message: '수업 정보를 정리하는 중입니다...',
    phase: 'prepare',
    percent: 5,
  });
  const schedule = {
    generatedAt: new Date().toISOString(),
    generationVersion: '2026-05-17-any-feasible-fallback-v1',
    classSchedules: {},
    itemSchedules: {},
    warnings: [],
  };
  const classDayCounts = {};
  const classPeriodCounts = {};
  const firstPeriodCounts = {};
  const activeItems = detailItems
    .filter((detailItem) => detailItem.item.active !== false)
    .sort((a, b) => getSchedulingPriority(a, settings) - getSchedulingPriority(b, settings));
  const allTasks = [];

  activeItems.forEach((detailItem) => {
      const item = detailItem.item;
      let stages = item.detailStages || createDefaultDetailStages(item, settings);
      const fixedClasses = item.fixedClasses || {};
      const classNumbers = [...(item.classNumbers || [])].sort((a, b) => a - b);
      const weeklyHours = Number(item.weeklyHours || 0);

      if (classNumbers.length === 0 || weeklyHours === 0) return;

      schedule.itemSchedules[detailItem.id] = {
        title: detailItem.title,
        subtitle: detailItem.subtitle,
        color: detailItem.color,
        slots: {},
      };

      if (item.continuous && !hasEnoughContinuousChains(stages, item, settings)) {
        stages = createDefaultDetailStages({ ...item, detailStages: undefined }, settings);
      }

      allTasks.push(...buildPlacementTasks({
        schedule,
        detailItem,
        item,
        stages,
        fixedClasses,
        classNumbers,
        weeklyHours,
        settings,
      }));
    });

  const balancedTasks = allTasks.filter((task) => !task.item.flexiblePlacement);
  const flexibleTasks = allTasks.filter((task) => task.item.flexiblePlacement);
  onProgress({
    message: '가능한 시간표 조합을 찾는 중입니다...',
    phase: 'search',
    percent: 12,
  });
  const constructiveResult = constructHumanStylePlacements({
    tasks: balancedTasks,
    settings,
    totalClassCount: settings.classCount,
    onProgress,
  });
  onProgress({
    message: '빈 시간 배치와 마지막 정리를 하는 중입니다...',
    phase: 'finalize',
    percent: 92,
  });
  const flexiblePlacements = placeFlexibleTasks(flexibleTasks, constructiveResult.placements);
  const allPlacements = [...constructiveResult.placements, ...flexiblePlacements];
  schedule.lowLoadDays = constructiveResult.lowLoadDays;
  schedule.dayCapacity = constructiveResult.dayCapacity;
  schedule.relaxedRules = Boolean(constructiveResult.relaxedRules);
  applyPlacementsToSchedule(schedule, allPlacements);

  const placedTaskIds = new Set(allPlacements.map((placement) => placement.taskId));
  allTasks
    .filter((task) => !placedTaskIds.has(task.id))
    .forEach((task) => schedule.warnings.push(getUnplacedTaskWarning(task)));
  if (schedule.relaxedRules && schedule.warnings.length === 0) {
    schedule.warnings.push('완성 가능한 시간표를 우선 만들기 위해 일부 균등 배치 규칙을 완화했습니다.');
  }
  schedule.variants = [];

  return schedule;
}

function getUnplacedTaskWarning(task) {
  if (!task.item.continuous && Number(task.item.weeklyHours || 0) > 1 && hasOnlyOneAvailableDay(task)) {
    return `${task.detailItem.title}: ${task.classNumber}반은 같은 날에만 ${task.item.weeklyHours}차시가 가능해 예외 규칙을 적용해야 합니다.`;
  }
  return `${task.detailItem.title}: ${task.label}을 배정하지 못했습니다.`;
}

function hasOnlyOneAvailableDay(task) {
  return new Set(task.candidates.map((candidate) => candidate.slots[0]?.day).filter(Boolean)).size <= 1;
}

function hasOnlyOneAvailableDayForItem(item) {
  return Object.entries(item.availableSlots || {}).filter(([, periods]) => periods.length > 0).length <= 1;
}

function createScheduleShell(detailItems) {
  const schedule = {
    generatedAt: new Date().toISOString(),
    classSchedules: {},
    itemSchedules: {},
    warnings: [],
  };

  detailItems.forEach((detailItem) => {
    schedule.itemSchedules[detailItem.id] = {
      title: detailItem.title,
      subtitle: detailItem.subtitle,
      color: detailItem.color,
      slots: {},
    };
  });

  return schedule;
}

function applyPlacementsToSchedule(schedule, placements) {
  const classDayCounts = {};
  const classPeriodCounts = {};
  const firstPeriodCounts = {};

  placements.forEach((placement) => {
    const itemSchedule = schedule.itemSchedules[placement.detailItem.id]?.slots || {};
    placement.slots.forEach((slot) => {
      placeLesson(
        schedule,
        itemSchedule,
        classDayCounts,
        classPeriodCounts,
        firstPeriodCounts,
        placement.detailItem,
        placement.item,
        slot,
        slot.stage,
        placement.classNumber
      );
    });
    schedule.itemSchedules[placement.detailItem.id].slots = itemSchedule;
  });
}

function placeFlexibleTasks(tasks, existingPlacements) {
  const state = buildStateFromPlacements(existingPlacements);
  const placements = [];

  [...tasks]
    .sort((a, b) => a.candidates.length - b.candidates.length)
    .forEach((task) => {
      const candidate = task.candidates.find((option) => canUseFlexibleCandidate(option, state));
      if (!candidate) return;
      applyPlacementToState(state, candidate);
      placements.push(candidate);
    });

  return placements;
}

function canUseFlexibleCandidate(candidate, state) {
  return candidate.slots.every((slot) => {
    if (state.occupiedClassSlots.has(`${candidate.classNumber}:${slot.key}`)) return false;
    return !getPlacementResourceKeys(candidate).some((resourceKey) =>
      (state.occupiedResourceSlots[`${resourceKey}:${slot.key}`] || 0) >= getSlotCapacity(candidate, slot)
    );
  });
}

function recordPlacementCounts(placements, classDayCounts, classPeriodCounts, firstPeriodCounts) {
  placements.forEach((placement) => {
    placement.slots.forEach((slot) => {
      classDayCounts[placement.classNumber] ||= {};
      classPeriodCounts[placement.classNumber] ||= {};
      classDayCounts[placement.classNumber][slot.day] = (classDayCounts[placement.classNumber][slot.day] || 0) + 1;
      classPeriodCounts[placement.classNumber][slot.period] = (classPeriodCounts[placement.classNumber][slot.period] || 0) + 1;
      if (slot.period === 1) {
        firstPeriodCounts[placement.classNumber] = (firstPeriodCounts[placement.classNumber] || 0) + 1;
      }
    });
  });
}

function constructHumanStylePlacements({ tasks, settings, totalClassCount, useSparseSeed = true, onProgress = () => {} }) {
  if (tasks.some((task) => task.item.continuous)) {
    const continuousFirst = constructWithContinuousCandidates({
      tasks,
      settings,
      totalClassCount,
      onProgress,
    });
    if (continuousFirst) {
      return finalizePlacements({
        placements: continuousFirst.placements,
        tasks,
        lowLoadDays: continuousFirst.lowLoadDays,
        dayCapacity: continuousFirst.dayCapacity,
        settings,
      });
    }
  }

  const lowLoadDays = [...getLowLoadDays(tasks, totalClassCount)].sort(
    (a, b) => countDayResourceSlots(tasks, a) - countDayResourceSlots(tasks, b)
  );
  const dayCapacity = getDayResourceSlotCounts(tasks);
  const state = createPlacementState();
  const seededTaskIds = useSparseSeed
    ? seedSparseDaysFirst({
        tasks,
        lowLoadDays,
        state,
      })
    : new Set();
  const stageGroups = buildStageGroups(tasks, lowLoadDays, seededTaskIds);
  let best = null;
  let searched = 0;
  const maxSearch = 1200000;
  const deadline = Date.now() + 20000;

  const walk = (groupIndex) => {
    if (searched >= maxSearch || Date.now() > deadline) return;
    if (groupIndex === stageGroups.length) {
      const candidate = {
        placements: [...state.placements],
        score: scoreWholeSchedule(state, settings, dayCapacity),
      };
      if (!best || candidate.score < best.score) best = candidate;
      return;
    }

    searched += 1;
    if (searched % 5000 === 0) {
      onProgress({
        message: '좋은 시간표를 찾는 중입니다...',
        phase: 'search',
        searched,
        percent: Math.min(70, 12 + Math.round((searched / maxSearch) * 58)),
      });
    }
    const group = stageGroups[groupIndex];
    const groupAssignments = enumerateGroupAssignments({
      group,
      state,
      lowLoadDays,
      settings,
      dayCapacity,
      limit: group.tasks.length <= 1 ? 40 : 4000,
    });

    groupAssignments.forEach((assignment) => {
      applyGroupAssignment(state, assignment);
      if (remainingGroupsStillFeasible(stageGroups, groupIndex + 1, state, lowLoadDays, settings, dayCapacity)) {
        walk(groupIndex + 1);
      }
      undoGroupAssignment(state, assignment);
    });
  };

  walk(0);

  if (!best && useSparseSeed && seededTaskIds.size > 0) {
    return constructHumanStylePlacements({
      tasks,
      settings,
      totalClassCount,
      useSparseSeed: false,
      onProgress,
    });
  }

  if (!best) {
    const greedyPlacements = constructGreedyPlacement({
      stageGroups,
      initialState: state,
      lowLoadDays,
      settings,
      dayCapacity,
    });
    if (greedyPlacements) {
      best = {
        placements: greedyPlacements,
        score: scoreWholeSchedule(buildStateFromPlacements(greedyPlacements), settings, dayCapacity),
      };
    }
  }

  if (!best && tasks.some((task) => task.item.continuous)) {
    const relaxedPlacements = constructRelaxedContinuousFallback({
      tasks,
      settings,
      totalClassCount,
      onProgress,
    });
    if (relaxedPlacements) {
      return finalizePlacements({
        placements: relaxedPlacements,
        tasks,
        lowLoadDays,
        dayCapacity,
        settings,
        relaxedRules: true,
      });
    }
  }

  if (!best) {
    const anyFeasiblePlacements = constructAnyFeasiblePlacement({
      tasks,
      settings,
      totalClassCount,
      onProgress,
    });
    if (anyFeasiblePlacements) {
      return finalizePlacements({
        placements: anyFeasiblePlacements,
        tasks,
        lowLoadDays,
        dayCapacity,
        settings,
        relaxedRules: true,
      });
    }
  }

  return finalizePlacements({
    placements: best?.placements || [],
    tasks,
    lowLoadDays,
    dayCapacity,
    settings,
    relaxedRules: false,
  });
}

function finalizePlacements({ placements, tasks, lowLoadDays, dayCapacity, settings, relaxedRules = false }) {
  const balancedPlacements = rebalanceEqualCapacityDays(
    placements,
    tasks,
    lowLoadDays,
    dayCapacity,
    relaxedRules
  );
  const continuousBalancedPlacements = improveDayBalanceByContinuousSwaps(
    balancedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity,
    relaxedRules
  );
  const improvedPlacements = improvePlacementsBySameStageSwaps(
    continuousBalancedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity,
    relaxedRules
  );
  const dayBalancedPlacements = improveDayBalanceBySameStageSwaps(
    improvedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity,
    relaxedRules
  );
  const bundleBalancedPlacements = improveDayBalanceByMultiStageSwaps(
    dayBalancedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity,
    relaxedRules
  );
  const finalPlacements = rebalanceEqualCapacityDays(
    bundleBalancedPlacements,
    tasks,
    lowLoadDays,
    dayCapacity,
    relaxedRules
  );

  return {
    placements: finalPlacements,
    lowLoadDays,
    dayCapacity,
    relaxedRules,
  };
}

function constructAnyFeasiblePlacement({ tasks, settings, totalClassCount, onProgress = () => {} }) {
  const lowLoadDays = [...getLowLoadDays(tasks, totalClassCount)].sort(
    (a, b) => countDayResourceSlots(tasks, a) - countDayResourceSlots(tasks, b)
  );
  const state = createPlacementState();
  const deadline = Date.now() + 20000;
  let searched = 0;
  const maxSearch = 1500000;
  const orderedTasks = [...tasks].sort((a, b) =>
    a.candidates.length - b.candidates.length ||
    Number(b.item.continuous) - Number(a.item.continuous)
  );

  const walk = (taskIndex) => {
    if (Date.now() > deadline || searched >= maxSearch) return false;
    if (taskIndex === orderedTasks.length) return true;

    searched += 1;
    if (searched % 5000 === 0) {
      onProgress({
        message: '완성 가능한 시간표를 우선 찾는 중입니다...',
        phase: 'fallback',
        searched,
        percent: Math.min(88, 70 + Math.round((searched / maxSearch) * 18)),
      });
    }
    const task = orderedTasks[taskIndex];
    const candidates = task.candidates
      .filter((candidate) => canUseHardCandidate(candidate, state))
      .sort((a, b) =>
        scoreConstructiveCandidate(a, state.classDayCounts, state.classPeriodCounts, state.firstPeriodCounts, settings) -
        scoreConstructiveCandidate(b, state.classDayCounts, state.classPeriodCounts, state.firstPeriodCounts, settings)
      );

    for (const candidate of candidates) {
      applyPlacementToState(state, candidate);
      if (remainingHardTasksStillFeasible(orderedTasks, taskIndex + 1, state) && walk(taskIndex + 1)) {
        return true;
      }
      undoPlacementFromState(state, candidate);
    }

    return false;
  };

  return walk(0) ? [...state.placements] : null;
}

function remainingHardTasksStillFeasible(tasks, startIndex, state) {
  return tasks.slice(startIndex).every((task) =>
    task.candidates.some((candidate) => canUseHardCandidate(candidate, state))
  );
}

function constructWithContinuousCandidates({ tasks, settings, totalClassCount, onProgress = () => {} }) {
  const continuousTasks = tasks.filter((task) => task.item.continuous);
  const regularTasks = tasks.filter((task) => !task.item.continuous);
  const continuousGroups = buildStageGroups(continuousTasks, [], new Set());
  const continuousAssignments = enumerateContinuousGroupCandidates(continuousGroups, 300);
  let best = null;

  for (const seedPlacements of continuousAssignments) {
    onProgress({
      message: '연차시 묶음을 포함한 조합을 확인하는 중입니다...',
      phase: 'continuous',
      percent: 18,
    });
    const state = createPlacementState();
    let validSeed = true;
    for (const placement of seedPlacements) {
      if (!canUseRelaxedContinuousCandidate(placement, state)) {
        validSeed = false;
        break;
      }
      applyPlacementToState(state, placement);
    }
    if (!validSeed) continue;

    const regularResult = constructFromInitialState({
      tasks: regularTasks,
      settings,
      totalClassCount,
      initialState: state,
    });
    if (!regularResult || regularResult.placements.length !== regularTasks.length + seedPlacements.length) continue;

    const score = scoreWholeSchedule(buildStateFromPlacements(regularResult.placements), settings, regularResult.dayCapacity);
    if (!best || score < best.score) {
      best = {
        placements: regularResult.placements,
        lowLoadDays: regularResult.lowLoadDays,
        dayCapacity: regularResult.dayCapacity,
        score,
      };
    }
  }

  return best
    ? {
        placements: best.placements,
        lowLoadDays: best.lowLoadDays,
        dayCapacity: best.dayCapacity,
      }
    : null;
}

function constructFromInitialState({ tasks, settings, totalClassCount, initialState }) {
  const lowLoadDays = [...getLowLoadDays(tasks, totalClassCount)].sort(
    (a, b) => countDayResourceSlots(tasks, a) - countDayResourceSlots(tasks, b)
  );
  const dayCapacity = getDayResourceSlotCounts(tasks);
  const state = clonePlacementState(initialState);
  const stageGroups = buildStageGroups(tasks, lowLoadDays, new Set());
  const placements = constructGreedyPlacement({
    stageGroups,
    initialState: state,
    lowLoadDays,
    settings,
    dayCapacity,
  });
  if (!placements) return null;
  return { placements, lowLoadDays, dayCapacity };
}

function enumerateContinuousGroupCandidates(groups, limit) {
  const results = [];
  const chosen = [];
  const state = createPlacementState();

  const walk = (index) => {
    if (results.length >= limit) return;
    if (index === groups.length) {
      results.push([...chosen]);
      return;
    }

    const group = groups[index];
    const assignments = enumerateRelaxedContinuousAssignments(group.tasks, state, limit - results.length);
    assignments.forEach((assignment) => {
      applyGroupAssignment(state, assignment);
      chosen.push(...assignment);
      walk(index + 1);
      chosen.splice(chosen.length - assignment.length, assignment.length);
      undoGroupAssignment(state, assignment);
    });
  };

  walk(0);
  return results;
}

function enumerateRelaxedContinuousAssignments(tasks, state, limit) {
  const results = [];
  const chosen = [];
  const tempState = clonePlacementState(state);

  const walk = (index) => {
    if (results.length >= limit) return;
    if (index === tasks.length) {
      results.push([...chosen]);
      return;
    }
    const task = tasks[index];
    for (const candidate of task.candidates) {
      if (!canUseRelaxedContinuousCandidate(candidate, tempState)) continue;
      applyPlacementToState(tempState, candidate);
      chosen.push(candidate);
      walk(index + 1);
      chosen.pop();
      undoPlacementFromState(tempState, candidate);
    }
  };

  walk(0);
  return results;
}

function constructRelaxedContinuousFallback({ tasks, settings, totalClassCount, onProgress = () => {} }) {
  const regularTasks = tasks.filter((task) => !task.item.continuous);
  const continuousTasks = tasks.filter((task) => task.item.continuous);
  if (continuousTasks.length === 0) return null;

  const regularResult = constructHumanStylePlacements({
    tasks: regularTasks,
    settings,
    totalClassCount,
    onProgress,
  });
  if (regularResult.placements.length !== regularTasks.length) return null;

  const state = buildStateFromPlacements(regularResult.placements);
  const continuousGroups = buildStageGroups(continuousTasks, [], new Set());

  for (const group of continuousGroups) {
    const assignment = findRelaxedContinuousAssignment(group.tasks, state);
    if (!assignment) return null;
    applyGroupAssignment(state, assignment);
  }

  return state.placements;
}

function findRelaxedContinuousAssignment(tasks, state) {
  const chosen = [];
  const tempState = clonePlacementState(state);

  const walk = (index) => {
    if (index === tasks.length) return true;
    const task = tasks[index];
    for (const candidate of task.candidates) {
      if (!canUseRelaxedContinuousCandidate(candidate, tempState)) continue;
      applyPlacementToState(tempState, candidate);
      chosen.push(candidate);
      if (walk(index + 1)) return true;
      chosen.pop();
      undoPlacementFromState(tempState, candidate);
    }
    return false;
  };

  return walk(0) ? chosen : null;
}

function canUseRelaxedContinuousCandidate(candidate, state) {
  return candidate.slots.every((slot) => {
    if (candidate.item.fixedClasses?.[slot.key] && candidate.item.fixedClasses[slot.key] !== candidate.classNumber) return false;
    if (state.occupiedClassSlots.has(`${candidate.classNumber}:${slot.key}`)) return false;
    return !getPlacementResourceKeys(candidate).some((resourceKey) =>
      (state.occupiedResourceSlots[`${resourceKey}:${slot.key}`] || 0) >= getSlotCapacity(candidate, slot)
    );
  });
}

function constructGreedyPlacement({ stageGroups, initialState, lowLoadDays, settings, dayCapacity }) {
  const state = clonePlacementState(initialState);

  for (const group of stageGroups) {
    const assignments = enumerateGroupAssignments({
      group,
      state,
      lowLoadDays,
      settings,
      dayCapacity,
      limit: group.tasks.length <= 1 ? 40 : 1000,
    });
    const assignment = assignments.find((candidate) => {
      applyGroupAssignment(state, candidate);
      const feasible = remainingGroupsStillFeasible(
        stageGroups,
        stageGroups.indexOf(group) + 1,
        state,
        lowLoadDays,
        settings,
        dayCapacity
      );
      undoGroupAssignment(state, candidate);
      return feasible;
    }) || assignments[0];

    if (!assignment) return null;
    applyGroupAssignment(state, assignment);
  }

  return state.placements;
}

function seedSparseDaysFirst({ tasks, lowLoadDays, state }) {
  const seededTaskIds = new Set();

  if (shouldSkipSparseSeeding(tasks, lowLoadDays)) return seededTaskIds;

  lowLoadDays.forEach((day) => {
    const placements = chooseDistinctPlacementsForDay({
      tasks,
      day,
      placedTaskIds: seededTaskIds,
      isFree: (candidate) => canUseCandidate(candidate, state, lowLoadDays),
    });

    placements.forEach((placement) => {
      applyPlacementToState(state, placement);
      seededTaskIds.add(placement.taskId);
    });
  });

  return seededTaskIds;
}

function shouldSkipSparseSeeding(tasks, lowLoadDays) {
  if (lowLoadDays.length === 0) return true;
  const candidateCounts = tasks.map((task) => task.candidates.length);
  const tightTaskCount = candidateCounts.filter((count) => count <= 2).length;
  return tightTaskCount >= Math.max(2, Math.floor(tasks.length * 0.1));
}

function buildStageGroups(tasks, lowLoadDays, excludedTaskIds = new Set()) {
  const groups = new Map();
  const seededCounts = new Map();

  tasks.forEach((task) => {
    const key = task.stage
      ? `${task.detailItem.id}:stage:${task.stage}`
      : `${task.detailItem.id}:continuous`;
    if (excludedTaskIds.has(task.id)) {
      seededCounts.set(key, (seededCounts.get(key) || 0) + 1);
      return;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  });

  return [...groups.entries()]
    .map(([key, groupTasks]) => ({
      key,
      tasks: [...groupTasks].sort((a, b) => a.candidates.length - b.candidates.length),
      isContinuous: groupTasks.some((task) => task.item.continuous),
      touchesLowLoadDay: groupTasks.some((task) => taskTouchesLowLoadDay(task, new Set(lowLoadDays))),
      seededCount: seededCounts.get(key) || 0,
      minCandidateCount: Math.min(...groupTasks.map((task) => task.candidates.length)),
      candidateCount: groupTasks.reduce((sum, task) => sum + task.candidates.length, 0),
    }))
    .sort((a, b) =>
      Number(b.isContinuous) - Number(a.isContinuous) ||
      b.seededCount - a.seededCount ||
      a.minCandidateCount - b.minCandidateCount ||
      Number(b.touchesLowLoadDay) - Number(a.touchesLowLoadDay) ||
      a.candidateCount - b.candidateCount ||
      b.tasks.length - a.tasks.length
    );
}

function createPlacementState() {
  return {
    placements: [],
    occupiedClassSlots: new Set(),
    occupiedResourceSlots: {},
    classDayCounts: {},
    classPeriodCounts: {},
    firstPeriodCounts: {},
    classEntries: {},
  };
}

function enumerateGroupAssignments({ group, state, lowLoadDays, settings, dayCapacity, limit }) {
  const results = [];
  const chosen = [];
  const usedTaskIds = new Set();
  const tempState = clonePlacementState(state);

  const walk = (index) => {
    if (results.length >= limit) return;
    if (index === group.tasks.length) {
      results.push({
        placements: [...chosen],
        score: scoreWholeSchedule(tempState, settings, dayCapacity),
      });
      return;
    }

    const task = group.tasks[index];
    const candidates = task.candidates
      .filter((candidate) => canUseCandidate(candidate, tempState, lowLoadDays))
      .sort((a, b) =>
        scoreConstructiveCandidate(a, tempState.classDayCounts, tempState.classPeriodCounts, tempState.firstPeriodCounts, settings) -
        scoreConstructiveCandidate(b, tempState.classDayCounts, tempState.classPeriodCounts, tempState.firstPeriodCounts, settings)
      );

    for (const candidate of candidates) {
      if (usedTaskIds.has(candidate.taskId)) continue;
      chosen.push(candidate);
      usedTaskIds.add(candidate.taskId);
      applyPlacementToState(tempState, candidate);
      walk(index + 1);
      undoPlacementFromState(tempState, candidate);
      usedTaskIds.delete(candidate.taskId);
      chosen.pop();
      if (results.length >= limit) break;
    }
  };

  walk(0);

  return results
    .sort((a, b) => a.score - b.score)
    .map((result) => result.placements);
}

function remainingGroupsStillFeasible(groups, startIndex, state, lowLoadDays, settings, dayCapacity) {
  return groups.slice(startIndex).every((group) =>
    enumerateGroupAssignments({
      group,
      state,
      lowLoadDays,
      settings,
      dayCapacity,
      limit: 1,
    }).length > 0
  );
}

function clonePlacementState(state) {
  return {
    placements: [...state.placements],
    occupiedClassSlots: new Set(state.occupiedClassSlots),
    occupiedResourceSlots: { ...state.occupiedResourceSlots },
    classDayCounts: cloneNestedCounts(state.classDayCounts),
    classPeriodCounts: cloneNestedCounts(state.classPeriodCounts),
    firstPeriodCounts: { ...state.firstPeriodCounts },
    classEntries: Object.fromEntries(
      Object.entries(state.classEntries).map(([classNumber, entries]) => [classNumber, { ...entries }])
    ),
  };
}

function canUseCandidate(candidate, state, lowLoadDays) {
  return candidate.slots.every((slot) => {
    if (candidate.item.fixedClasses?.[slot.key] && candidate.item.fixedClasses[slot.key] !== candidate.classNumber) return false;
    if (state.occupiedClassSlots.has(`${candidate.classNumber}:${slot.key}`)) return false;
    if (getPlacementResourceKeys(candidate).some((resourceKey) =>
      (state.occupiedResourceSlots[`${resourceKey}:${slot.key}`] || 0) >= getSlotCapacity(candidate, slot)
    )) return false;
    if (!candidate.item.continuous && lowLoadDays.includes(slot.day) && (state.classDayCounts[candidate.classNumber]?.[slot.day] || 0) >= 1) return false;
    if (
      !candidate.item.continuous &&
      !hasOnlyOneAvailableDayForItem(candidate.item) &&
      hasSameSubjectOnDay(state.classEntries[candidate.classNumber] || {}, candidate.detailItem, slot.day)
    ) return false;
    if (!candidate.item.continuous && hasAdjacentSameLesson(state.classEntries[candidate.classNumber] || {}, candidate.detailItem.id, slot)) return false;
    return true;
  });
}

function canUseHardCandidate(candidate, state) {
  return candidate.slots.every((slot) => {
    if (candidate.item.fixedClasses?.[slot.key] && candidate.item.fixedClasses[slot.key] !== candidate.classNumber) return false;
    if (state.occupiedClassSlots.has(`${candidate.classNumber}:${slot.key}`)) return false;
    return !getPlacementResourceKeys(candidate).some((resourceKey) =>
      (state.occupiedResourceSlots[`${resourceKey}:${slot.key}`] || 0) >= getSlotCapacity(candidate, slot)
    );
  });
}

function applyGroupAssignment(state, assignment) {
  assignment.forEach((placement) => applyPlacementToState(state, placement));
}

function undoGroupAssignment(state, assignment) {
  [...assignment].reverse().forEach((placement) => undoPlacementFromState(state, placement));
}

function applyPlacementToState(state, placement) {
  state.placements.push(placement);
  placement.slots.forEach((slot) => {
    state.occupiedClassSlots.add(`${placement.classNumber}:${slot.key}`);
    getPlacementResourceKeys(placement).forEach((resourceKey) => {
      const key = `${resourceKey}:${slot.key}`;
      state.occupiedResourceSlots[key] = (state.occupiedResourceSlots[key] || 0) + 1;
    });
    state.classDayCounts[placement.classNumber] ||= {};
    state.classPeriodCounts[placement.classNumber] ||= {};
    state.classEntries[placement.classNumber] ||= {};
    state.classDayCounts[placement.classNumber][slot.day] = (state.classDayCounts[placement.classNumber][slot.day] || 0) + 1;
    state.classPeriodCounts[placement.classNumber][slot.period] = (state.classPeriodCounts[placement.classNumber][slot.period] || 0) + 1;
    state.classEntries[placement.classNumber][slot.key] = {
      itemId: placement.detailItem.id,
      subjectKey: getSubjectKey(placement.detailItem),
      stage: slot.stage,
    };
    if (slot.period === 1) state.firstPeriodCounts[placement.classNumber] = (state.firstPeriodCounts[placement.classNumber] || 0) + 1;
  });
}

function undoPlacementFromState(state, placement) {
  state.placements.pop();
  placement.slots.forEach((slot) => {
    state.occupiedClassSlots.delete(`${placement.classNumber}:${slot.key}`);
    getPlacementResourceKeys(placement).forEach((resourceKey) => {
      const key = `${resourceKey}:${slot.key}`;
      state.occupiedResourceSlots[key] -= 1;
      if (state.occupiedResourceSlots[key] === 0) delete state.occupiedResourceSlots[key];
    });
    state.classDayCounts[placement.classNumber][slot.day] -= 1;
    if (state.classDayCounts[placement.classNumber][slot.day] === 0) delete state.classDayCounts[placement.classNumber][slot.day];
    state.classPeriodCounts[placement.classNumber][slot.period] -= 1;
    if (state.classPeriodCounts[placement.classNumber][slot.period] === 0) delete state.classPeriodCounts[placement.classNumber][slot.period];
    delete state.classEntries[placement.classNumber][slot.key];
    if (slot.period === 1) {
      state.firstPeriodCounts[placement.classNumber] -= 1;
      if (state.firstPeriodCounts[placement.classNumber] === 0) delete state.firstPeriodCounts[placement.classNumber];
    }
  });
}

function scoreWholeSchedule(state, settings, dayCapacity) {
  const placementScore = state.placements.reduce(
    (score, placement) =>
      score + scoreConstructiveCandidate(
        placement,
        state.classDayCounts,
        state.classPeriodCounts,
        state.firstPeriodCounts,
        settings
      ),
    0
  );
  return placementScore + scoreDayBalance(state.classDayCounts, settings, dayCapacity);
}

function scoreDayBalance(classDayCounts, settings, dayCapacity) {
  const dayKeys = Object.keys(dayLabels);
  const periodsByDay = settings.periodsByDay;
  const totalPeriods = Object.values(periodsByDay).reduce((sum, count) => sum + count, 0);
  const sameCapacityGroups = Object.values(
    dayKeys.reduce((groups, day) => {
      const key = dayCapacity[day] || 0;
      groups[key] ||= [];
      groups[key].push(day);
      return groups;
    }, {})
  ).filter((days) => days.length > 1);

  return Object.values(classDayCounts).reduce((totalScore, counts) => {
    const totalLessons = countClassLessons(counts);
    if (totalLessons === 0) return totalScore;

    const dayScore = dayKeys.reduce((score, day) => {
      const actual = counts[day] || 0;
      const ideal = totalLessons * (periodsByDay[day] / totalPeriods);
      const diff = actual - ideal;
      return score + diff * diff * 2600;
    }, 0);

    const sameCapacityScore = sameCapacityGroups.reduce((score, days) => {
      const values = days.map((day) => counts[day] || 0);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return score + values.reduce((sum, value) => sum + (value - average) ** 2 * 12000, 0);
    }, 0);

    const countsByDay = dayKeys.map((day) => counts[day] || 0);
    const maxDayCount = Math.max(...countsByDay);
    const concentrationScore = Math.max(0, maxDayCount - Math.ceil(totalLessons / 3)) ** 2 * 18000;

    return totalScore + dayScore + sameCapacityScore + concentrationScore;
  }, 0);
}

function improveDayBalanceByContinuousSwaps(placements, tasks, lowLoadDays, settings, dayCapacity, relaxedRules) {
  const continuousItemIds = [...new Set(
    tasks
      .filter((task) => task.item.continuous)
      .map((task) => task.detailItem.id)
  )];
  let improved = [...placements];
  let changed = true;
  let rounds = 0;

  while (changed && rounds < 30) {
    changed = false;
    rounds += 1;
    const currentState = buildStateFromPlacements(improved);
    const currentScore = scoreDayBalance(currentState.classDayCounts, settings, dayCapacity);
    let bestSwap = null;

    for (const itemId of continuousItemIds) {
      const itemPlacements = improved.filter((placement) =>
        placement.detailItem.id === itemId &&
        placement.item.continuous &&
        !hasFixedPlacement(placement)
      );

      for (let leftIndex = 0; leftIndex < itemPlacements.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < itemPlacements.length; rightIndex += 1) {
          const left = itemPlacements[leftIndex];
          const right = itemPlacements[rightIndex];
          if (left.classNumber === right.classNumber) continue;
          if (left.slots[0]?.day === right.slots[0]?.day) continue;

          const candidatePlacements = improved.map((placement) => {
            if (placement.taskId === left.taskId) return { ...left, slots: right.slots };
            if (placement.taskId === right.taskId) return { ...right, slots: left.slots };
            return placement;
          });
          if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays, relaxedRules)) continue;

          const candidateState = buildStateFromPlacements(candidatePlacements);
          const candidateScore = scoreDayBalance(candidateState.classDayCounts, settings, dayCapacity);
          if (candidateScore >= currentScore) continue;

          if (!bestSwap || candidateScore < bestSwap.score) {
            bestSwap = {
              placements: candidatePlacements,
              score: candidateScore,
            };
          }
        }
      }
    }

    if (bestSwap) {
      improved = bestSwap.placements;
      changed = true;
    }
  }

  return improved;
}

function improvePlacementsBySameStageSwaps(placements, tasks, lowLoadDays, settings, dayCapacity, relaxedRules) {
  const groups = buildStageGroups(tasks, lowLoadDays);
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  let improved = [...placements];
  let changed = true;
  let rounds = 0;

  while (changed && rounds < 12) {
    changed = false;
    rounds += 1;

    for (const group of groupByKey.values()) {
      const groupPlacements = improved.filter((placement) =>
        placementBelongsToGroup(placement, group)
      );

      outer:
      for (let leftIndex = 0; leftIndex < groupPlacements.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < groupPlacements.length; rightIndex += 1) {
          const left = groupPlacements[leftIndex];
          const right = groupPlacements[rightIndex];
          if (left.classNumber === right.classNumber) continue;
          if (left.item.continuous || right.item.continuous) continue;
          if (hasFixedPlacement(left) || hasFixedPlacement(right)) continue;

          const candidatePlacements = improved.map((placement) => {
            if (placement.taskId === left.taskId) return { ...left, slots: right.slots };
            if (placement.taskId === right.taskId) return { ...right, slots: left.slots };
            return placement;
          });

          if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays, relaxedRules)) continue;

          const currentState = buildStateFromPlacements(improved);
          const candidateState = buildStateFromPlacements(candidatePlacements);
          if (worsensEqualCapacityBalance(currentState.classDayCounts, candidateState.classDayCounts, dayCapacity)) continue;

          const currentScore = scoreWholeSchedule(currentState, settings, dayCapacity);
          const candidateScore = scoreWholeSchedule(candidateState, settings, dayCapacity);
          if (candidateScore + 1 < currentScore) {
            improved = candidatePlacements;
            changed = true;
            break outer;
          }
        }
      }
    }
  }

  return improved;
}

function improveDayBalanceBySameStageSwaps(placements, tasks, lowLoadDays, settings, dayCapacity, relaxedRules) {
  const groups = buildStageGroups(tasks, lowLoadDays);
  let improved = [...placements];
  let changed = true;
  let rounds = 0;

  while (changed && rounds < 40) {
    changed = false;
    rounds += 1;
    const currentState = buildStateFromPlacements(improved);
    const currentScore = scoreDayBalance(currentState.classDayCounts, settings, dayCapacity);
    let bestSwap = null;

    for (const group of groups) {
      const groupPlacements = improved.filter((placement) =>
        placementBelongsToGroup(placement, group) && placement.slots.length === 1
      );

      for (let leftIndex = 0; leftIndex < groupPlacements.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < groupPlacements.length; rightIndex += 1) {
          const left = groupPlacements[leftIndex];
          const right = groupPlacements[rightIndex];
          if (left.classNumber === right.classNumber) continue;
          if (left.item.continuous || right.item.continuous) continue;
          if (hasFixedPlacement(left) || hasFixedPlacement(right)) continue;
          if (left.slots[0].day === right.slots[0].day) continue;

          const candidatePlacements = improved.map((placement) => {
            if (placement.taskId === left.taskId) return { ...left, slots: right.slots };
            if (placement.taskId === right.taskId) return { ...right, slots: left.slots };
            return placement;
          });
          if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays, relaxedRules)) continue;

          const candidateState = buildStateFromPlacements(candidatePlacements);
          const candidateScore = scoreDayBalance(candidateState.classDayCounts, settings, dayCapacity);
          if (candidateScore >= currentScore) continue;

          if (!bestSwap || candidateScore < bestSwap.score) {
            bestSwap = {
              placements: candidatePlacements,
              score: candidateScore,
            };
          }
        }
      }
    }

    if (bestSwap) {
      improved = bestSwap.placements;
      changed = true;
    }
  }

  return improved;
}

function improveDayBalanceByMultiStageSwaps(placements, tasks, lowLoadDays, settings, dayCapacity, relaxedRules) {
  const itemIds = [...new Set(tasks.map((task) => task.detailItem.id))];
  let improved = [...placements];
  let changed = true;
  let rounds = 0;

  while (changed && rounds < 30) {
    changed = false;
    rounds += 1;
    const currentState = buildStateFromPlacements(improved);
    const currentScore = scoreDayBalance(currentState.classDayCounts, settings, dayCapacity);
    let bestSwap = null;

    for (const itemId of itemIds) {
      const itemPlacements = improved.filter((placement) =>
        placement.detailItem.id === itemId &&
        !placement.item.continuous &&
        !hasFixedPlacement(placement) &&
        placement.slots.length === 1 &&
        placement.slots[0]?.stage
      );
      const classNumbers = [...new Set(itemPlacements.map((placement) => placement.classNumber))];

      for (let leftIndex = 0; leftIndex < classNumbers.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < classNumbers.length; rightIndex += 1) {
          const leftClass = classNumbers[leftIndex];
          const rightClass = classNumbers[rightIndex];
          const leftByStage = new Map(
            itemPlacements
              .filter((placement) => placement.classNumber === leftClass)
              .map((placement) => [placement.slots[0].stage, placement])
          );
          const rightByStage = new Map(
            itemPlacements
              .filter((placement) => placement.classNumber === rightClass)
              .map((placement) => [placement.slots[0].stage, placement])
          );
          const sharedStages = [...leftByStage.keys()].filter((stage) => rightByStage.has(stage));

          for (const stages of getStageSubsets(sharedStages)) {
            if (stages.length < 2) continue;
            const replacementSlots = new Map();
            stages.forEach((stage) => {
              const left = leftByStage.get(stage);
              const right = rightByStage.get(stage);
              replacementSlots.set(left.taskId, right.slots);
              replacementSlots.set(right.taskId, left.slots);
            });

            const candidatePlacements = improved.map((placement) =>
              replacementSlots.has(placement.taskId)
                ? { ...placement, slots: replacementSlots.get(placement.taskId) }
                : placement
            );
            if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays, relaxedRules)) continue;

            const candidateState = buildStateFromPlacements(candidatePlacements);
            const candidateScore = scoreDayBalance(candidateState.classDayCounts, settings, dayCapacity);
            if (candidateScore >= currentScore) continue;

            if (!bestSwap || candidateScore < bestSwap.score) {
              bestSwap = {
                placements: candidatePlacements,
                score: candidateScore,
              };
            }
          }
        }
      }
    }

    if (bestSwap) {
      improved = bestSwap.placements;
      changed = true;
    }
  }

  return improved;
}

function getStageSubsets(stages) {
  const subsets = [];
  for (let mask = 1; mask < 2 ** stages.length; mask += 1) {
    const subset = stages.filter((_, index) => mask & (1 << index));
    subsets.push(subset);
  }
  return subsets;
}

function worsensEqualCapacityBalance(beforeCounts, afterCounts, dayCapacity) {
  return getEqualCapacityDayPairs(dayCapacity).some(([leftDay, rightDay]) =>
    equalDaySpreadForAllClasses(afterCounts, leftDay, rightDay) >
    equalDaySpreadForAllClasses(beforeCounts, leftDay, rightDay)
  );
}

function hasFixedPlacement(placement) {
  return placement.slots.some((slot) => Boolean(placement.item.fixedClasses?.[slot.key]));
}

function rebalanceEqualCapacityDays(placements, tasks, lowLoadDays, dayCapacity, relaxedRules = false) {
  const equalDayPairs = getEqualCapacityDayPairs(dayCapacity);
  const groups = buildStageGroups(tasks, lowLoadDays);
  let improved = [...placements];
  let rounds = 0;

  while (rounds < 80) {
    rounds += 1;
    const currentState = buildStateFromPlacements(improved);
    let bestSwap = null;

    for (const [leftDay, rightDay] of equalDayPairs) {
      for (const group of groups) {
        const groupPlacements = improved.filter((placement) =>
          placementBelongsToGroup(placement, group) &&
          placement.slots.length === 1 &&
          [leftDay, rightDay].includes(placement.slots[0].day)
        );

        for (let leftIndex = 0; leftIndex < groupPlacements.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < groupPlacements.length; rightIndex += 1) {
            const first = groupPlacements[leftIndex];
            const second = groupPlacements[rightIndex];
            if (first.item.continuous || second.item.continuous) continue;
            if (hasFixedPlacement(first) || hasFixedPlacement(second)) continue;
            if (first.slots[0].day === second.slots[0].day) continue;

            const before = equalDaySpreadForClasses(
              currentState.classDayCounts,
              [first.classNumber, second.classNumber],
              leftDay,
              rightDay
            );
            const candidatePlacements = improved.map((placement) => {
              if (placement.taskId === first.taskId) return { ...first, slots: second.slots };
              if (placement.taskId === second.taskId) return { ...second, slots: first.slots };
              return placement;
            });
            if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays, relaxedRules)) continue;

            const candidateState = buildStateFromPlacements(candidatePlacements);
            const after = equalDaySpreadForClasses(
              candidateState.classDayCounts,
              [first.classNumber, second.classNumber],
              leftDay,
              rightDay
            );

            const pairSpreadBefore = equalDaySpreadForAllClasses(
              currentState.classDayCounts,
              leftDay,
              rightDay
            );
            const pairSpreadAfter = equalDaySpreadForAllClasses(
              candidateState.classDayCounts,
              leftDay,
              rightDay
            );
            const improvement = pairSpreadBefore - pairSpreadAfter;
            const localImprovement = before - after;

            if (
              improvement > 0 &&
              (!bestSwap ||
                improvement > bestSwap.improvement ||
                (improvement === bestSwap.improvement && localImprovement > bestSwap.localImprovement))
            ) {
              bestSwap = {
                placements: candidatePlacements,
                improvement,
                localImprovement,
              };
            }
          }
        }
      }
    }

    if (!bestSwap) break;
    improved = bestSwap.placements;
  }

  return improved;
}

function getEqualCapacityDayPairs(dayCapacity) {
  const pairs = [];
  const days = Object.keys(dayLabels);

  for (let leftIndex = 0; leftIndex < days.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < days.length; rightIndex += 1) {
      const leftDay = days[leftIndex];
      const rightDay = days[rightIndex];
      if ((dayCapacity[leftDay] || 0) > 0 && dayCapacity[leftDay] === dayCapacity[rightDay]) {
        pairs.push([leftDay, rightDay]);
      }
    }
  }

  return pairs;
}

function equalDaySpreadForClasses(classDayCounts, classNumbers, leftDay, rightDay) {
  return classNumbers.reduce((score, classNumber) => {
    const leftCount = classDayCounts[classNumber]?.[leftDay] || 0;
    const rightCount = classDayCounts[classNumber]?.[rightDay] || 0;
    return score + Math.abs(leftCount - rightCount);
  }, 0);
}

function equalDaySpreadForAllClasses(classDayCounts, leftDay, rightDay) {
  return Object.keys(classDayCounts).reduce((score, classNumber) => {
    const leftCount = classDayCounts[classNumber]?.[leftDay] || 0;
    const rightCount = classDayCounts[classNumber]?.[rightDay] || 0;
    return score + Math.abs(leftCount - rightCount);
  }, 0);
}

function placementBelongsToGroup(placement, group) {
  return group.tasks.some((task) => task.id === placement.taskId);
}

function buildStateFromPlacements(placements) {
  const state = createPlacementState();
  placements.forEach((placement) => applyPlacementToState(state, placement));
  return state;
}

function allPlacementsRemainValid(placements, lowLoadDays, relaxedRules = false) {
  const state = createPlacementState();

  for (const placement of placements) {
    const isValid = relaxedRules
      ? canUseHardCandidate(placement, state)
      : canUseCandidate(placement, state, lowLoadDays);
    if (!isValid) return false;
    applyPlacementToState(state, placement);
  }

  return true;
}

function countDayResourceSlots(tasks, day) {
  const keys = new Set();
  tasks.forEach((task) => {
    task.candidates.forEach((candidate) => {
      candidate.slots.forEach((slot) => {
        if (slot.day !== day) return;
        getPlacementResourceKeys(candidate).forEach((resourceKey) => keys.add(`${resourceKey}:${slot.key}`));
      });
    });
  });
  return keys.size;
}

function getDayResourceSlotCounts(tasks) {
  return Object.fromEntries(
    Object.keys(dayLabels).map((day) => [day, countDayResourceSlots(tasks, day)])
  );
}

function chooseDistinctPlacementsForDay({ tasks, day, placedTaskIds, isFree }) {
  const groups = buildLowLoadSlotGroups(tasks, day, placedTaskIds);
  const usedClasses = new Set();
  const usedTaskIds = new Set();
  const chosen = [];

  const walk = (index) => {
    if (index === groups.length) return true;
    for (const candidate of groups[index].candidates) {
      if (usedClasses.has(candidate.classNumber)) continue;
      if (usedTaskIds.has(candidate.taskId)) continue;
      if (!isFree(candidate)) continue;
      usedClasses.add(candidate.classNumber);
      usedTaskIds.add(candidate.taskId);
      chosen.push(candidate);
      if (walk(index + 1)) return true;
      chosen.pop();
      usedClasses.delete(candidate.classNumber);
      usedTaskIds.delete(candidate.taskId);
    }
    return false;
  };

  return walk(0) ? chosen : [];
}

function countSiblingStagePlacements(task, placements) {
  return placements.filter(
    (placement) =>
      placement.detailItem.id === task.detailItem.id &&
      placement.slots[0]?.stage === task.stage
  ).length;
}

function violatesConstructiveDayRule(candidate, lowLoadDays, classDayCounts) {
  return candidate.slots.some(
    (slot) => lowLoadDays.includes(slot.day) && (classDayCounts[candidate.classNumber]?.[slot.day] || 0) >= 1
  );
}

function scoreConstructiveCandidate(candidate, classDayCounts, classPeriodCounts, firstPeriodCounts, settings) {
  return candidate.slots.reduce((score, slot) => {
    const classSchedule = {};
    return score + scoreDistributionForSlot({
      classSchedule,
      classDayCounts,
      classPeriodCounts,
      firstPeriodCounts,
      slot,
      classNumber: candidate.classNumber,
      settings,
    });
  }, 0);
}

function getSchedulingPriority(detailItem, settings) {
  const item = detailItem.item;
  const weeklyHours = Number(item.weeklyHours || 0);
  const classCount = item.classNumbers?.length || 0;
  const availableCount = countAvailableSlots(item.availableSlots);
  const continuousWeight = item.continuous ? -10000 : 0;
  const tightness = availableCount - classCount * weeklyHours;

  return continuousWeight + tightness * 20 - classCount * 5;
}

function optimizeItemSchedule({
  schedule,
  itemSchedule,
  classDayCounts,
  classPeriodCounts,
  firstPeriodCounts,
  detailItem,
  item,
  stages,
  fixedClasses,
  classNumbers,
  weeklyHours,
  settings,
}) {
  const tasks = buildPlacementTasks({ schedule, detailItem, item, stages, fixedClasses, classNumbers, weeklyHours, settings });

  if (tasks.some((task) => task.candidates.length === 0)) {
    tasks
      .filter((task) => task.candidates.length === 0)
      .forEach((task) => schedule.warnings.push(`${detailItem.title}: ${task.label} 후보 시간이 없습니다.`));
    return;
  }

  const bestPlacements = searchBestPlacements({
    schedule,
    classDayCounts,
    classPeriodCounts,
    firstPeriodCounts,
    detailItem,
    item,
    tasks,
  });

  if (!bestPlacements) {
    schedule.warnings.push(`${detailItem.title}: 조건을 모두 만족하는 배정을 찾지 못했습니다.`);
    return;
  }

  bestPlacements.placements.forEach((placement) => {
    placement.slots.forEach((slot) => {
      placeLesson(
        schedule,
        itemSchedule,
        classDayCounts,
        classPeriodCounts,
        firstPeriodCounts,
        detailItem,
        item,
        slot,
        slot.stage,
        placement.classNumber
      );
    });
  });
}

function buildPlacementTasks({ schedule, detailItem, item, stages, fixedClasses, classNumbers, weeklyHours, settings }) {
  if (item.continuous && weeklyHours > 1) {
    const chains = getContinuousChains(stages, weeklyHours, settings);
    return classNumbers.map((classNumber) => {
      const fixedSlotKeys = Object.entries(fixedClasses)
        .filter(([, fixedClass]) => fixedClass === classNumber)
        .map(([slotKey]) => slotKey);
      const candidates = chains
        .filter((chain) => fixedSlotKeys.every((slotKey) => chain.some((slot) => slot.key === slotKey)))
        .filter((chain) => chain.every((slot) => !fixedClasses[slot.key] || fixedClasses[slot.key] === classNumber))
        .filter((chain) => canPlaceChain(schedule, classNumber, chain));

      return {
        id: `${detailItem.id}:${classNumber}:continuous`,
        label: `${classNumber}반 연차시`,
        detailItem,
        item,
        classNumber,
        candidates: candidates.map((chain) => ({ taskId: `${detailItem.id}:${classNumber}:continuous`, detailItem, item, classNumber, slots: chain })),
      };
    });
  }

  return classNumbers.flatMap((classNumber) =>
    Array.from({ length: weeklyHours }, (_, index) => {
      const stage = index + 1;
      const stageSlots = getStageSlots(stages, stage, settings);
      const fixedSlotKeys = Object.entries(fixedClasses)
        .filter(([slotKey, fixedClass]) => fixedClass === classNumber && stages[slotKey] === stage)
        .map(([slotKey]) => slotKey);
      const candidateSlots = (fixedSlotKeys.length > 0
        ? stageSlots.filter((slot) => fixedSlotKeys.includes(slot.key))
        : stageSlots
      )
        .filter((slot) => !fixedClasses[slot.key] || fixedClasses[slot.key] === classNumber)
        .filter((slot) => !schedule.classSchedules[classNumber]?.[slot.key]);

      return {
        id: `${detailItem.id}:${classNumber}:${stage}`,
        label: `${classNumber}반 ${stage}차시`,
        detailItem,
        item,
        classNumber,
        stage,
        candidates: candidateSlots.map((slot) => ({
          taskId: `${detailItem.id}:${classNumber}:${stage}`,
          detailItem,
          item,
          classNumber,
          slots: [{ ...slot, stage }],
        })),
      };
    })
  );
}

function searchBestPlacements({ schedule, classDayCounts, classPeriodCounts, firstPeriodCounts, tasks, totalClassCount, settings }) {
  const lowLoadDays = getLowLoadDays(tasks, totalClassCount);
  const sortedTasks = [...tasks].sort((a, b) => {
    const aLowLoad = taskTouchesLowLoadDay(a, lowLoadDays) ? 0 : 1;
    const bLowLoad = taskTouchesLowLoadDay(b, lowLoadDays) ? 0 : 1;
    return aLowLoad - bLowLoad || a.candidates.length - b.candidates.length;
  });
  const occupiedClassSlots = new Set();
  const occupiedResourceSlots = new Set();
  const tempClassEntries = {};
  const tempDayCounts = cloneNestedCounts(classDayCounts);
  const tempPeriodCounts = cloneNestedCounts(classPeriodCounts);
  const tempFirstCounts = { ...firstPeriodCounts };
  let best = { score: Number.POSITIVE_INFINITY, placements: [], placedCount: 0 };
  const variants = [];
  let searched = 0;
  let stoppedEarly = false;
  const maxSearch = 1200000;
  const deadline = Date.now() + 20000;
  const missPenalty = 1000000;

  const applyPlacement = (placement) => {
    placement.slots.forEach((slot) => {
      occupiedClassSlots.add(`${placement.classNumber}:${slot.key}`);
      getPlacementResourceKeys(placement).forEach((resourceKey) => occupiedResourceSlots.add(`${resourceKey}:${slot.key}`));
      tempClassEntries[placement.classNumber] ||= {};
      tempClassEntries[placement.classNumber][slot.key] = {
        itemId: placement.detailItem.id,
        subjectKey: getSubjectKey(placement.detailItem),
        stage: slot.stage,
      };
      tempDayCounts[placement.classNumber] ||= {};
      tempPeriodCounts[placement.classNumber] ||= {};
      tempDayCounts[placement.classNumber][slot.day] = (tempDayCounts[placement.classNumber][slot.day] || 0) + 1;
      tempPeriodCounts[placement.classNumber][slot.period] = (tempPeriodCounts[placement.classNumber][slot.period] || 0) + 1;
      if (slot.period === 1) tempFirstCounts[placement.classNumber] = (tempFirstCounts[placement.classNumber] || 0) + 1;
    });
  };

  const undoPlacement = (placement) => {
    placement.slots.forEach((slot) => {
      occupiedClassSlots.delete(`${placement.classNumber}:${slot.key}`);
      getPlacementResourceKeys(placement).forEach((resourceKey) => occupiedResourceSlots.delete(`${resourceKey}:${slot.key}`));
      delete tempClassEntries[placement.classNumber][slot.key];
      tempDayCounts[placement.classNumber][slot.day] -= 1;
      tempPeriodCounts[placement.classNumber][slot.period] -= 1;
      if (slot.period === 1) tempFirstCounts[placement.classNumber] -= 1;
    });
  };

  const isValidPlacement = (placement) => {
    if (placement.slots.some((slot) => getPlacementResourceKeys(placement).some((resourceKey) => occupiedResourceSlots.has(`${resourceKey}:${slot.key}`)))) return false;
    if (placement.slots.some((slot) => occupiedClassSlots.has(`${placement.classNumber}:${slot.key}`))) return false;
    if (placement.slots.some((slot) => schedule.classSchedules[placement.classNumber]?.[slot.key])) return false;
    if (!placement.item.continuous && !hasOnlyOneAvailableDayForItem(placement.item) && placement.slots.some((slot) => hasSameSubjectOnDay(
      getMergedClassSchedule(schedule, tempClassEntries, placement.classNumber),
      placement.detailItem,
      slot.day
    ))) return false;
    if (!placement.item.continuous && placement.slots.some((slot) => hasAdjacentSameLesson(getMergedClassSchedule(schedule, tempClassEntries, placement.classNumber), placement.detailItem.id, slot))) {
      return false;
    }
    if (violatesLowLoadDayLimit(placement)) return false;
    if (createsAvoidableDayRepeat(placement)) return false;
    return true;
  };

  const violatesLowLoadDayLimit = (placement) => {
    const addedByDay = {};
    placement.slots.forEach((slot) => {
      if (!lowLoadDays.has(slot.day)) return;
      addedByDay[slot.day] = (addedByDay[slot.day] || 0) + 1;
    });

    return Object.entries(addedByDay).some(([day, addedCount]) => {
      const currentCount = tempDayCounts[placement.classNumber]?.[day] || 0;
      return currentCount + addedCount > 1;
    });
  };

  const createsAvoidableDayRepeat = (placement) => {
    if (placement.item.continuous) return false;
    const repeatedDay = placement.slots.some((slot) => (tempDayCounts[placement.classNumber]?.[slot.day] || 0) > 0);
    if (!repeatedDay) return false;

    const task = sortedTasks.find((candidateTask) => candidateTask.id === placement.taskId);
    if (!task) return false;

    return task.candidates.some((candidate) => {
      if (candidate === placement) return false;
      if (candidate.classNumber !== placement.classNumber) return false;
      const hasFreshDay = candidate.slots.every((slot) => (tempDayCounts[candidate.classNumber]?.[slot.day] || 0) === 0);
      return hasFreshDay && candidate.slots.every((slot) => {
        if (occupiedClassSlots.has(`${candidate.classNumber}:${slot.key}`)) return false;
        if (schedule.classSchedules[candidate.classNumber]?.[slot.key]) return false;
        return !getPlacementResourceKeys(candidate).some((resourceKey) => occupiedResourceSlots.has(`${resourceKey}:${slot.key}`));
      });
    });
  };

  const scorePlacement = (placement) => placement.slots.reduce((sum, slot) => {
    const classSchedule = getMergedClassSchedule(schedule, tempClassEntries, placement.classNumber);
    return sum + scoreDistributionForSlot({
      classSchedule,
      classDayCounts: tempDayCounts,
      classPeriodCounts: tempPeriodCounts,
      firstPeriodCounts: tempFirstCounts,
      slot,
      classNumber: placement.classNumber,
      settings,
    });
  }, 0);

  const walk = (index, chosen, score) => {
    searched += 1;
    if (searched > maxSearch || Date.now() > deadline) {
      stoppedEarly = true;
      return;
    }

    if (index === sortedTasks.length) {
      const placedCount = chosen.length;
      if (placedCount > best.placedCount || (placedCount === best.placedCount && score < best.score)) {
        best = { score, placements: [...chosen], placedCount };
      }
      addVariant(variants, { score, placements: [...chosen], placedCount });
      return;
    }

    const task = sortedTasks[index];
    const candidates = task.candidates
      .filter(isValidPlacement)
      .map((candidate) => ({ ...candidate, score: scorePlacement(candidate) }))
      .sort((a, b) => a.score - b.score);

    const candidateLimit = taskTouchesLowLoadDay(task, lowLoadDays)
      ? candidates.length
      : tasks.length > 18
        ? 16
        : 24;
    candidates.slice(0, candidateLimit).forEach((candidate) => {
      if (chosen.length + (sortedTasks.length - index) < best.placedCount) return;
      if (variants.length >= 5 && chosen.length + (sortedTasks.length - index) === best.placedCount && score + candidate.score >= variants[4].score) return;
      applyPlacement(candidate);
      chosen.push(candidate);
      walk(index + 1, chosen, score + candidate.score);
      chosen.pop();
      undoPlacement(candidate);
    });

    walk(index + 1, chosen, score + missPenalty);
  };

  walk(0, [], 0);
  return { placements: best.placements, variants: variants.slice(0, 5), searched, stoppedEarly };
}

function addVariant(variants, candidate) {
  if (candidate.placedCount === 0) return;
  const signature = candidate.placements
    .map((placement) => `${placement.taskId}:${placement.slots.map((slot) => slot.key).join('+')}`)
    .sort()
    .join('|');
  if (variants.some((variant) => variant.signature === signature)) return;

  variants.push({ ...candidate, signature });
  variants.sort((a, b) => b.placedCount - a.placedCount || a.score - b.score);
  if (variants.length > 8) variants.pop();
}

function getLowLoadDays(tasks, totalClassCount) {
  const dayResourceSlots = Object.fromEntries(Object.keys(dayLabels).map((day) => [day, new Set()]));

  tasks.forEach((task) => {
    task.candidates.forEach((candidate) => {
      const resourceKey = getPlacementResourceKeys(candidate).sort().join('|');
      candidate.slots.forEach((slot) => {
        dayResourceSlots[slot.day]?.add(`${resourceKey}:${slot.key}`);
      });
    });
  });

  return new Set(
    Object.entries(dayResourceSlots)
      .filter(([, resourceSlots]) => resourceSlots.size > 0 && resourceSlots.size <= totalClassCount)
      .map(([day]) => day)
  );
}

function taskTouchesLowLoadDay(task, lowLoadDays) {
  return task.candidates.some((candidate) => candidate.slots.some((slot) => lowLoadDays.has(slot.day)));
}

function seedLowLoadDayPlacements(tasks, lowLoadDays) {
  const placements = [];
  const usedTaskIds = new Set();

  lowLoadDays.forEach((day) => {
    const slotGroups = buildLowLoadSlotGroups(tasks, day, usedTaskIds);
    const chosen = findDistinctLowLoadDayPlacements(slotGroups);
    if (!chosen) return;

    chosen.forEach((placement) => {
      placements.push(placement);
      usedTaskIds.add(placement.taskId);
    });
  });

  return placements;
}

function chooseFeasibleLowLoadSeed({ allTasks, lowLoadDays, schedule, settings }) {
  const seedVariants = generateLowLoadSeedVariants(allTasks, lowLoadDays, 30);
  if (seedVariants.length === 0) return [];

  let bestSeed = [];
  let bestPlacedCount = -1;

  seedVariants.forEach((seedPlacements) => {
    const seededTaskIds = new Set(seedPlacements.map((placement) => placement.taskId));
    const remainingTasks = allTasks.filter((task) => !seededTaskIds.has(task.id));
    const classDayCounts = {};
    const classPeriodCounts = {};
    const firstPeriodCounts = {};
    const tempSchedule = createScheduleShell([...new Set(allTasks.map((task) => task.detailItem))]);
    applyPlacementsToSchedule(tempSchedule, seedPlacements);
    recordPlacementCounts(seedPlacements, classDayCounts, classPeriodCounts, firstPeriodCounts);

    const result = searchBestPlacements({
      schedule: tempSchedule,
      classDayCounts,
      classPeriodCounts,
      firstPeriodCounts,
      tasks: remainingTasks,
      totalClassCount: settings.classCount,
      settings,
    });

    const placedCount = seedPlacements.length + result.placements.length;
    if (placedCount > bestPlacedCount) {
      bestPlacedCount = placedCount;
      bestSeed = seedPlacements;
    }
  });

  return bestSeed;
}

function generateLowLoadSeedVariants(tasks, lowLoadDays, limit = 20) {
  const dayVariants = [...lowLoadDays].map((day) => {
    const slotGroups = buildLowLoadSlotGroups(tasks, day, new Set());
    return findDistinctLowLoadDayPlacementVariants(slotGroups, limit);
  });

  let combined = [[]];
  dayVariants.forEach((variants) => {
    const next = [];
    combined.forEach((prefix) => {
      variants.forEach((variant) => {
        next.push([...prefix, ...variant]);
      });
    });
    combined = next.slice(0, limit);
  });

  return combined;
}

function buildLowLoadSlotGroups(tasks, day, usedTaskIds) {
  const groups = new Map();

  tasks.forEach((task) => {
    if (usedTaskIds.has(task.id)) return;
    task.candidates.forEach((candidate) => {
      if (candidate.slots.length !== 1) return;
      const slot = candidate.slots[0];
      if (slot.day !== day) return;
      getPlacementResourceKeys(candidate).forEach((resourceKey) => {
        const key = `${resourceKey}:${slot.key}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(candidate);
      });
    });
  });

  return [...groups.entries()]
    .map(([key, candidates]) => ({ key, candidates }))
    .sort((a, b) => a.candidates.length - b.candidates.length);
}

function findDistinctLowLoadDayPlacements(slotGroups) {
  const usedClasses = new Set();
  const usedTaskIds = new Set();
  const chosen = [];

  const walk = (index) => {
    if (index === slotGroups.length) return true;

    for (const candidate of slotGroups[index].candidates) {
      if (usedClasses.has(candidate.classNumber)) continue;
      if (usedTaskIds.has(candidate.taskId)) continue;

      usedClasses.add(candidate.classNumber);
      usedTaskIds.add(candidate.taskId);
      chosen.push(candidate);

      if (walk(index + 1)) return true;

      chosen.pop();
      usedClasses.delete(candidate.classNumber);
      usedTaskIds.delete(candidate.taskId);
    }

    return false;
  };

  return walk(0) ? chosen : null;
}

function findDistinctLowLoadDayPlacementVariants(slotGroups, limit = 20) {
  const variants = [];
  const usedClasses = new Set();
  const usedTaskIds = new Set();
  const chosen = [];

  const walk = (index) => {
    if (variants.length >= limit) return;
    if (index === slotGroups.length) {
      variants.push([...chosen]);
      return;
    }

    for (const candidate of slotGroups[index].candidates) {
      if (usedClasses.has(candidate.classNumber)) continue;
      if (usedTaskIds.has(candidate.taskId)) continue;

      usedClasses.add(candidate.classNumber);
      usedTaskIds.add(candidate.taskId);
      chosen.push(candidate);
      walk(index + 1);
      chosen.pop();
      usedClasses.delete(candidate.classNumber);
      usedTaskIds.delete(candidate.taskId);
    }
  };

  walk(0);
  return variants;
}

function repairLowLoadDayAssignments(placements, tasks, totalClassCount) {
  const lowLoadDays = getLowLoadDays(tasks, totalClassCount);
  let repaired = [...placements];

  lowLoadDays.forEach((day) => {
    const dayPlacements = repaired.filter((placement) => placement.slots.some((slot) => slot.day === day));
    if (dayPlacements.length === 0 || dayPlacements.length > totalClassCount) return;

    const uniqueClasses = new Set(dayPlacements.map((placement) => placement.classNumber));
    if (uniqueClasses.size === dayPlacements.length) return;

    const replacement = findDistinctDayReplacement(dayPlacements, tasks, repaired, day);
    if (!replacement) return;

    repaired = repaired.map((placement) => replacement.get(placement.taskId) || placement);
  });

  return repaired;
}

function findDistinctDayReplacement(dayPlacements, tasks, allPlacements, day) {
  const targetTaskIds = new Set(dayPlacements.map((placement) => placement.taskId));
  const fixedPlacements = allPlacements.filter((placement) => !targetTaskIds.has(placement.taskId));
  const occupiedClassSlots = new Set();
  const occupiedResourceSlots = new Set();

  fixedPlacements.forEach((placement) => {
    placement.slots.forEach((slot) => {
      occupiedClassSlots.add(`${placement.classNumber}:${slot.key}`);
      getPlacementResourceKeys(placement).forEach((resourceKey) => occupiedResourceSlots.add(`${resourceKey}:${slot.key}`));
    });
  });

  const dayTasks = tasks
    .filter((task) => targetTaskIds.has(task.id))
    .map((task) => ({
      ...task,
      candidates: task.candidates.filter(
        (candidate) =>
          candidate.slots.some((slot) => slot.day === day) &&
          candidate.slots.every((slot) => {
            if (occupiedClassSlots.has(`${candidate.classNumber}:${slot.key}`)) return false;
            return !getPlacementResourceKeys(candidate).some((resourceKey) => occupiedResourceSlots.has(`${resourceKey}:${slot.key}`));
          })
      ),
    }))
    .sort((a, b) => a.candidates.length - b.candidates.length);

  const usedClasses = new Set();
  const usedResourceSlots = new Set();
  const chosen = new Map();

  const walk = (index) => {
    if (index === dayTasks.length) return true;
    const task = dayTasks[index];

    for (const candidate of task.candidates) {
      if (usedClasses.has(candidate.classNumber)) continue;
      const hasResourceConflict = candidate.slots.some((slot) =>
        getPlacementResourceKeys(candidate).some((resourceKey) => usedResourceSlots.has(`${resourceKey}:${slot.key}`))
      );
      if (hasResourceConflict) continue;

      usedClasses.add(candidate.classNumber);
      candidate.slots.forEach((slot) => getPlacementResourceKeys(candidate).forEach((resourceKey) => usedResourceSlots.add(`${resourceKey}:${slot.key}`)));
      chosen.set(task.id, candidate);

      if (walk(index + 1)) return true;

      chosen.delete(task.id);
      usedClasses.delete(candidate.classNumber);
      candidate.slots.forEach((slot) => getPlacementResourceKeys(candidate).forEach((resourceKey) => usedResourceSlots.delete(`${resourceKey}:${slot.key}`)));
    }

    return false;
  };

  return walk(0) ? chosen : null;
}

function getContinuousChains(stages, weeklyHours, settings) {
  const chains = [];

  Object.keys(dayLabels).forEach((day) => {
    for (let period = 1; period <= settings.periodsByDay[day]; period += 1) {
      const chain = Array.from({ length: weeklyHours }, (_, index) => {
        const chainPeriod = period + index;
        return { day, period: chainPeriod, key: createSlotKey(day, chainPeriod), order: 0, stage: index + 1 };
      });
      const hasChain = chain.every(
        (slot) => slot.period <= settings.periodsByDay[day] && stages[slot.key] === slot.stage
      );
      if (hasChain) chains.push(chain);
    }
  });

  return chains;
}

function canPlaceChain(schedule, classNumber, chain) {
  return chain.every((slot) => !schedule.classSchedules[classNumber]?.[slot.key]);
}

function placeChain(schedule, itemSchedule, classDayCounts, classPeriodCounts, firstPeriodCounts, detailItem, item, chain, classNumber) {
  chain.forEach((slot) => {
    placeLesson(schedule, itemSchedule, classDayCounts, classPeriodCounts, firstPeriodCounts, detailItem, item, slot, slot.stage, classNumber);
  });
}

function scoreChainForClass(schedule, classDayCounts, classPeriodCounts, firstPeriodCounts, chain, classNumber) {
  return chain.reduce((score, slot) => {
    const classSchedule = schedule.classSchedules[classNumber] || {};
    return score + scoreDistributionForSlot({
      classSchedule,
      classDayCounts,
      classPeriodCounts,
      firstPeriodCounts,
      slot,
      classNumber,
      extraDayCount: chain.filter((chainSlot) => chainSlot.day === slot.day && chainSlot.period < slot.period).length,
      extraPeriodCount: chain.filter((chainSlot) => chainSlot.period === slot.period && chainSlot.day !== slot.day).length,
    });
  }, 0);
}

function chooseClassForSlot({ schedule, classDayCounts, classPeriodCounts, firstPeriodCounts, itemClassBySlot, detailItem, item, slot, stage, settings, remainingClasses }) {
  const previous = getPreviousSlot(slot, settings);
  const previousClass = previous ? itemClassBySlot[`${detailItem.id}:${previous}`] : null;

  if (item.continuous && stage > 1 && previousClass && remainingClasses.includes(previousClass)) {
    const previousEntry = schedule.classSchedules[previousClass]?.[previous];
    const slotIsEmpty = !schedule.classSchedules[previousClass]?.[slot.key];
    if (previousEntry?.itemId === detailItem.id && previousEntry.stage === stage - 1 && slotIsEmpty) {
      return previousClass;
    }
  }

  return remainingClasses
    .map((classNumber) => ({
      classNumber,
      score: scoreClassForSlot({
        schedule,
        classDayCounts,
        classPeriodCounts,
        firstPeriodCounts,
        item,
        detailItem,
        slot,
        stage,
        classNumber,
        previousClass,
        settings,
      }),
    }))
    .sort((a, b) => a.score - b.score || a.classNumber - b.classNumber)[0]?.classNumber;
}

function scoreClassForSlot({ schedule, classDayCounts, classPeriodCounts, firstPeriodCounts, item, detailItem, slot, stage, classNumber, previousClass, settings }) {
  const classSchedule = schedule.classSchedules[classNumber] || {};
  let score = 0;

  if (classSchedule[slot.key]) score += 10000;

  if (item.continuous && stage > 1 && previousClass) {
    score += previousClass === classNumber ? -2000 : 2000;
  }

  if (!item.continuous && hasAdjacentSameLesson(classSchedule, detailItem.id, slot)) {
    score += 900;
  }

  score += scoreDistributionForSlot({
    classSchedule,
    classDayCounts,
    classPeriodCounts,
    firstPeriodCounts,
    slot,
    classNumber,
    settings,
  });

  if ((classDayCounts[classNumber]?.[slot.day] || 0) >= 1 && hasAdjacentAnyLesson(classSchedule, slot)) {
    score -= 4;
  }

  return score;
}

function scoreDistributionForSlot({
  classSchedule,
  classDayCounts,
  classPeriodCounts,
  firstPeriodCounts,
  slot,
  classNumber,
  settings,
  extraDayCount = 0,
  extraPeriodCount = 0,
}) {
  let score = 0;
  const dayCount = (classDayCounts[classNumber]?.[slot.day] || 0) + extraDayCount;
  const periodCount = (classPeriodCounts[classNumber]?.[slot.period] || 0) + extraPeriodCount;
  const totalCount = countClassLessons(classDayCounts[classNumber]);
  const projectedDayCount = dayCount + 1;
  const periodsByDay = settings?.periodsByDay || Object.fromEntries(Object.keys(dayLabels).map((day) => [day, 1]));
  const totalPeriods = Object.values(periodsByDay).reduce((sum, count) => sum + count, 0);
  const dayCapacityShare = periodsByDay[slot.day] / totalPeriods;
  const idealDayCount = Math.ceil((totalCount + 1) * dayCapacityShare);
  const inverseCapacity = totalPeriods / periodsByDay[slot.day];

  score += dayCount * dayCount * 900 * inverseCapacity;
  score += Math.max(0, projectedDayCount - idealDayCount) * 1200 * inverseCapacity;
  if (dayCount >= 1) score += 20000 * inverseCapacity;
  if (dayCount >= 2) score += 60000 * inverseCapacity;
  score += periodCount * periodCount * 360;

  if (slot.period === 1) {
    score += (firstPeriodCounts[classNumber] || 0) * 60;
  }

  return score;
}

function cloneNestedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, { ...value }])
  );
}

function getMergedClassSchedule(schedule, tempClassEntries, classNumber) {
  return {
    ...(schedule.classSchedules[classNumber] || {}),
    ...(tempClassEntries[classNumber] || {}),
  };
}

function getPlacementResourceKeys(placement) {
  if (placement.item.teacherIds?.length > 0) {
    return placement.item.teacherIds.map((teacherId) => `teacher:${teacherId}`);
  }
  if (placement.item.teacherName) {
    return [`external:${placement.item.teacherName}`];
  }
  return [`item:${placement.detailItem.id}`];
}

function getSlotCapacity(placement, slot) {
  return Math.max(1, Number(placement.item.slotCapacities?.[slot.key] || 1));
}

function countClassLessons(dayCounts = {}) {
  return Object.values(dayCounts).reduce((sum, count) => sum + count, 0);
}

function placeLesson(schedule, itemSchedule, classDayCounts, classPeriodCounts, firstPeriodCounts, detailItem, item, slot, stage, classNumber) {
  schedule.classSchedules[classNumber] ||= {};
  classDayCounts[classNumber] ||= {};
  classPeriodCounts[classNumber] ||= {};

  if (schedule.classSchedules[classNumber][slot.key]) {
    schedule.warnings.push(`${formatSlotKey(slot.key)}: ${classNumber}반에 이미 다른 수업이 있어 ${detailItem.title}을 배정하지 못했습니다.`);
    return false;
  }

  const entry = {
    title: detailItem.title,
    subtitle: detailItem.subtitle,
    color: detailItem.color,
    stage,
    classNumber,
    itemId: detailItem.id,
    subjectKey: getSubjectKey(detailItem),
    continuous: Boolean(item.continuous),
  };

  schedule.classSchedules[classNumber][slot.key] = entry;
  if (itemSchedule[slot.key]) {
    itemSchedule[slot.key] = Array.isArray(itemSchedule[slot.key])
      ? [...itemSchedule[slot.key], entry]
      : [itemSchedule[slot.key], entry];
  } else {
    itemSchedule[slot.key] = entry;
  }
  classDayCounts[classNumber][slot.day] = (classDayCounts[classNumber][slot.day] || 0) + 1;
  classPeriodCounts[classNumber][slot.period] = (classPeriodCounts[classNumber][slot.period] || 0) + 1;
  if (slot.period === 1) {
    firstPeriodCounts[classNumber] = (firstPeriodCounts[classNumber] || 0) + 1;
  }

  return true;
}

function getStageSlots(stages, stage, settings) {
  return getAllSlots(settings)
    .filter((slot) => stages[slot.key] === stage)
    .sort((a, b) => a.order - b.order);
}

function getAllSlots(settings) {
  let order = 0;
  return Object.keys(dayLabels).flatMap((day) =>
    Array.from({ length: settings.periodsByDay[day] }, (_, index) => {
      order += 1;
      const period = index + 1;
      return { day, period, key: createSlotKey(day, period), order };
    })
  );
}

function getPreviousSlot(slot, settings) {
  if (slot.period <= 1) return null;
  return slot.period - 1 <= settings.periodsByDay[slot.day] ? createSlotKey(slot.day, slot.period - 1) : null;
}

function settingsFromSlotList(slots) {
  return {
    periodsByDay: Object.fromEntries(
      Object.keys(dayLabels).map((day) => [day, Math.max(0, ...(slots?.[day] || []))])
    ),
  };
}

function getSubjectKey(detailItem) {
  if (detailItem.kind === 'assignment') return `subject:${detailItem.item.subjectId}`;
  return `oneTime:${detailItem.title.trim()}`;
}

function hasSameSubjectOnDay(classSchedule, detailItem, day) {
  const subjectKey = getSubjectKey(detailItem);
  return Object.entries(classSchedule).some(([slotKey, entry]) =>
    slotKey.startsWith(`${day}-`) && entry.subjectKey === subjectKey
  );
}

function hasAdjacentSameLesson(classSchedule, itemId, slot) {
  return getNeighborSlotKeys(slot).some((slotKey) => {
    const entry = classSchedule[slotKey];
    return entry && entry.itemId === itemId;
  });
}

function hasAdjacentAnyLesson(classSchedule, slot) {
  return getNeighborSlotKeys(slot).some((slotKey) => Boolean(classSchedule[slotKey]));
}

function getNeighborSlotKeys(slot) {
  const keys = [];
  if (slot.period > 1) keys.push(createSlotKey(slot.day, slot.period - 1));
  keys.push(createSlotKey(slot.day, slot.period + 1));
  return keys;
}

export { generateWeeklySchedule };
