import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Exercise the real module's internals without adding a browser-facing API.
const source = readFileSync(new URL('./scheduler.js', import.meta.url), 'utf8')
  .replace("'./continuous.js'", JSON.stringify(new URL('./continuous.js', import.meta.url).href));
const scheduler = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { completeMissingPlacements, buildPlacementTasks, createDefaultDetailStages, allPlacementsRemainValid, canUseCandidate, buildStateFromPlacements };`).toString('base64')}`);
const settings = { classCount: 8, periodsByDay: { mon: 6, tue: 6, wed: 5, thu: 6, fri: 6 } };
const repair = (tasks, placements = [], extra = {}) => scheduler.completeMissingPlacements({
  tasks, placements, settings, lowLoadDays: [], dayCapacity: { mon: 6, tue: 6, wed: 5, thu: 6, fri: 6 }, ...extra,
});
function task(id, keys, extra = {}) {
  const item = { teacherIds: [id], subjectId: id, weeklyHours: 1, availableSlots: { mon: [1, 2, 3], tue: [1, 2] }, ...extra };
  const detailItem = { id, kind: 'assignment', title: id, item };
  return { id, item, detailItem, classNumber: 1, candidates: keys.map((key) => ({
    taskId: id, item, detailItem, classNumber: 1,
    slots: key.split('+').map((slotKey, index) => {
      const [day, period] = slotKey.split('-');
      return { key: slotKey, day, period: Number(period), stage: index + 1 };
    }),
  })) };
}
function verify(tasks, result, lowLoadDays = []) {
  assert.equal(new Set(result.map((p) => p.taskId)).size, result.length);
  assert.ok(scheduler.allPlacementsRemainValid(result, lowLoadDays));
  const placed = new Set(result.map((p) => p.taskId));
  const state = scheduler.buildStateFromPlacements(result);
  for (const missing of tasks.filter((t) => !placed.has(t.id))) {
    assert.ok(!missing.candidates.some((c) => scheduler.canUseCandidate(c, state, lowLoadDays)), 'A directly usable lesson was left out');
  }
}
test('fills a free continuous pair even with relocation disabled', () => {
  const tasks = [task('english', ['tue-3+tue-4'], { continuous: true, weeklyHours: 2 })];
  const result = repair(tasks, [], { repairMilliseconds: 0 });
  assert.equal(result.length, 1);
  assert.equal(result[0].slots.length, 2);
  verify(tasks, result);
});
test('restores a chain of displaced lessons without losing existing tasks', () => {
  const a = task('a', ['mon-1', 'mon-2']);
  const b = task('b', ['mon-2', 'mon-3']);
  const c = task('c', ['mon-1']);
  const tasks = [a, b, c];
  const result = repair(tasks, [a.candidates[0], b.candidates[0]]);
  assert.equal(result.length, 3);
  verify(tasks, result);
});
test('does not move a fixed lesson or allow blocked classes', () => {
  const a = task('a', ['mon-1', 'mon-2'], { fixedClasses: { 'mon-1': 1 } });
  const b = task('b', ['mon-1']);
  const c = task('c', ['tue-1'], { blockedClasses: { 'tue-1': [1] } });
  const result = repair([a, b, c], [a.candidates[0]]);
  assert.deepEqual(result, [a.candidates[0]]);
  verify([a, b, c], result);
});
test('respects subject/day, adjacency, low-load days and resource capacity', () => {
  const cases = [
    { a: task('a', ['mon-1']), b: task('b', ['mon-3'], { subjectId: 'a' }) },
    { a: task('a', ['mon-1']), b: task('b', ['mon-3']), lowLoadDays: ['mon'] },
    { a: task('a', ['mon-1']), b: task('b', ['mon-1'], { teacherIds: ['a'] }), otherClass: true },
  ];
  for (const { a, b, lowLoadDays = [], otherClass } of cases) {
    if (otherClass) b.candidates[0].classNumber = b.classNumber = 2;
    const result = repair([a, b], [a.candidates[0]], { lowLoadDays });
    assert.equal(result.length, 1);
    verify([a, b], result, lowLoadDays);
  }
  const a = task('a', ['mon-1'], { teacherIds: ['shared'], slotCapacities: { 'mon-1': 2 } });
  const b = task('b', ['mon-1'], { teacherIds: ['shared'], slotCapacities: { 'mon-1': 2 } });
  b.candidates[0].classNumber = b.classNumber = 2;
  const result = repair([a, b], [a.candidates[0]]);
  assert.equal(result.length, 2);
  verify([a, b], result);
});

const backupPath = process.env.SCHEDULE_BACKUP_PATH;
test('explicit 1-2 link keeps stage 3 independent even in adjacent table cells', () => {
  const item = { subjectId: 'explicit', teacherIds: ['teacher'], weeklyHours: 3, classNumbers: [1, 2], continuous: true,
    continuousLinks: [1], availableSlots: { mon: [1, 2, 3], tue: [1, 2, 3] },
    detailStages: { 'mon-1': 1, 'mon-2': 2, 'mon-3': 3, 'tue-1': 1, 'tue-2': 2, 'tue-3': 3 } };
  const detailItem = { id: 'explicit', kind: 'assignment', title: 'English', item };
  const build = () => scheduler.buildPlacementTasks({ schedule: { classSchedules: {} }, detailItem, item,
    stages: item.detailStages, fixedClasses: {}, classNumbers: item.classNumbers, weeklyHours: 3, settings });
  const tasks = build();
  const pair = tasks.find((t) => t.classNumber === 1 && t.item.continuous).candidates[0];
  const single = tasks.find((t) => t.classNumber === 1 && t.stage === 3).candidates[0];
  assert.deepEqual(pair.slots.map((s) => s.stage), [1, 2]);
  assert.equal(scheduler.canUseCandidate(single, scheduler.buildStateFromPlacements([pair]), []), false);
  assert.equal(scheduler.canUseCandidate(pair, scheduler.buildStateFromPlacements([single]), []), false);
  const result = scheduler.generateWeeklySchedule({}, [detailItem], settings);
  assert.equal(result.warnings.length, 0);
  for (const c of [1, 2]) {
    const entries = Object.entries(result.classSchedules[c]);
    assert.equal(entries.length, 3);
    const day = (stage) => entries.find(([, e]) => e.stage === stage)[0].split('-')[0];
    assert.equal(day(1), day(2));
    assert.notEqual(day(2), day(3));
  }
  item.flexiblePlacement = true;
  const flexibleResult = scheduler.generateWeeklySchedule({}, [detailItem], settings);
  assert.equal(flexibleResult.warnings.length, 0);
  for (const c of [1, 2]) {
    const entries = Object.entries(flexibleResult.classSchedules[c]);
    const day = (stage) => entries.find(([, e]) => e.stage === stage)[0].split('-')[0];
    assert.notEqual(day(2), day(3));
  }
  // An explicit empty selection overrides automatic inference as well.
  item.continuousLinks = [];
  assert.ok(build().every((t) => !t.item.continuous && t.candidates.every((p) => p.slots.length === 1)));
});

test('continuous setting supports stages 1-2 together and stage 3 separately', () => {
  const item = { subjectId: 'partial', teacherIds: ['partialTeacher'], classNumbers: [1, 2], weeklyHours: 3,
    continuous: true, availableSlots: { mon: [1, 2], tue: [1, 2], wed: [5], fri: [5] },
    detailStages: { 'mon-1': 1, 'mon-2': 2, 'tue-1': 1, 'tue-2': 2, 'wed-5': 3, 'fri-5': 3 },
    fixedClasses: { 'fri-5': 1, 'wed-5': 2 }, blockedClasses: { 'mon-1': [2] } };
  const detailItem = { id: 'partial', kind: 'assignment', title: 'English', item };
  const tasks = scheduler.buildPlacementTasks({ schedule: { classSchedules: {} }, detailItem, item,
    stages: item.detailStages, fixedClasses: item.fixedClasses, blockedClasses: item.blockedClasses,
    classNumbers: item.classNumbers, weeklyHours: item.weeklyHours, settings });
  assert.equal(tasks.length, 4);
  for (const task of tasks) {
    for (const candidate of task.candidates) {
      assert.deepEqual(candidate.slots.map((slot) => slot.stage), task.item.continuous ? [1, 2] : [3]);
    }
  }
  const result = scheduler.generateWeeklySchedule({}, [detailItem], settings);
  for (const classNumber of item.classNumbers) {
    const entries = Object.entries(result.classSchedules[classNumber]);
    assert.equal(entries.length, 3);
    const first = entries.find(([, entry]) => entry.stage === 1);
    const second = entries.find(([, entry]) => entry.stage === 2);
    assert.equal(first[0].split('-')[0], second[0].split('-')[0]);
    assert.equal(Number(second[0].split('-')[1]) - Number(first[0].split('-')[1]), 1);
    const third = entries.find(([, entry]) => entry.stage === 3);
    assert.equal(third[0], classNumber === 1 ? 'fri-5' : 'wed-5');
    assert.equal(third[1].continuous, false);
  }
  assert.equal(result.warnings.length, 0);
});

test('full three-stage chains and stages 2-3 chains retain their stage numbers', () => {
  for (const [stages, expected] of [
    [{ 'mon-1': 1, 'mon-2': 2, 'mon-3': 3 }, [[1, 2, 3]]],
    [{ 'mon-1': 1, 'tue-1': 2, 'tue-2': 3 }, [[1], [2, 3]]],
  ]) {
    const item = { continuous: true, weeklyHours: 3, availableSlots: { mon: [1, 2, 3], tue: [1, 2] } };
    const detailItem = { id: 'groups', kind: 'assignment', item };
    const tasks = scheduler.buildPlacementTasks({ schedule: { classSchedules: {} }, detailItem, item,
      stages, fixedClasses: {}, classNumbers: [1], weeklyHours: 3, settings });
    assert.deepEqual(tasks.map((task) => task.candidates[0].slots.map((slot) => slot.stage)), expected);
  }
});

test('reserves all three unavoidable hours before movable or duplicate lessons', () => {
  const item = { subjectId: 'english', teacherIds: ['teacher'], classNumbers: [1], weeklyHours: 3,
    continuous: false, availableSlots: { wed: [1, 2], fri: [5] } };
  const movable = { subjectId: 'science', teacherIds: ['scienceTeacher'], classNumbers: [1], weeklyHours: 1,
    availableSlots: { wed: [1], tue: [1] }, detailStages: { 'wed-1': 1, 'tue-1': 1 } };
  const duplicate = { subjectId: 'duplicate', teacherIds: ['duplicateTeacher'], classNumbers: [1], weeklyHours: 1,
    availableSlots: { fri: [5] }, flexiblePlacement: true };
  const details = [item, movable, duplicate].map((lesson) => ({ id: lesson.subjectId, kind: 'assignment', title: lesson.subjectId, item: lesson }));
  const result = scheduler.generateWeeklySchedule({}, details, settings);
  const slots = result.classSchedules[1];
  assert.deepEqual(['wed-1', 'wed-2', 'fri-5'].map((key) => slots[key]?.itemId), ['english', 'english', 'english']);
  assert.equal(slots['tue-1'].itemId, 'science');
  assert.equal(Object.keys(slots).length, 4);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /duplicate.*충돌/);
});

test('unavoidable reservations still reject teacher overlap across classes', () => {
  const details = [1, 2].map((classNumber) => ({ id: `lesson${classNumber}`, kind: 'assignment', title: 'English', item: {
    subjectId: 'english', teacherIds: ['shared'], classNumbers: [classNumber], weeklyHours: 1, availableSlots: { wed: [1] },
  } }));
  const result = scheduler.generateWeeklySchedule({}, details, settings);
  assert.equal(Object.values(result.classSchedules).flatMap(Object.values).length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /충돌/);
});

test('12-06 backup: recovers 8th class English and preserves genuine conflicts', { skip: !backupPath }, () => {
  const { data } = JSON.parse(readFileSync(backupPath, 'utf8'));
  const plan = data.weeklyPlans.find((p) => p.startDate === '2026-12-06');
  const details = [
    ...plan.planAssignments.map((item) => ({ id: item.id, kind: 'assignment', title: data.subjects.find((s) => s.id === item.subjectId).name, item })),
    ...plan.oneTimeLessons.map((item) => ({ id: item.id, kind: 'oneTime', title: item.name, item })),
  ];
  const tasks = details.flatMap((detailItem) => {
    const item = detailItem.item;
    return scheduler.buildPlacementTasks({ schedule: { classSchedules: {} }, detailItem, item,
      stages: item.detailStages || scheduler.createDefaultDetailStages(item, data.settings),
      fixedClasses: item.fixedClasses || {}, blockedClasses: item.blockedClasses || {},
      classNumbers: item.classNumbers, weeklyHours: item.weeklyHours, settings: data.settings });
  });
  const placements = tasks.flatMap((t) => {
    const entries = plan.generatedSchedule.classSchedules[t.classNumber] || {};
    const keys = Object.entries(entries).filter(([, e]) => e.itemId === t.detailItem.id && (!t.stage || e.stage === t.stage)).map(([key]) => key);
    return t.candidates.filter((c) => c.slots.length === keys.length && c.slots.every((slot) => keys.includes(slot.key))).slice(0, 1);
  });
  const result = repair(tasks, placements, { settings: data.settings, lowLoadDays: plan.generatedSchedule.lowLoadDays, dayCapacity: plan.generatedSchedule.dayCapacity });
  assert.equal(placements.reduce((n, p) => n + p.slots.length, 0), 38);
  assert.equal(result.reduce((n, p) => n + p.slots.length, 0), 40);
  const recovered = result.find((p) => p.classNumber === 8 && p.item.continuous);
  assert.deepEqual(recovered.slots.map((s) => s.key), ['tue-3', 'tue-4']);
  for (const original of placements) assert.ok(result.some((p) => p.taskId === original.taskId));
  verify(tasks, result, plan.generatedSchedule.lowLoadDays);
});
