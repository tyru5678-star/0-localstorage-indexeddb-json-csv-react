import { generateWeeklySchedule } from './scheduler';

self.onmessage = (event) => {
  try {
    const { plan, detailItems, settings } = event.data;
    const schedule = generateWeeklySchedule(plan, detailItems, settings, (progress) => {
      self.postMessage({
        type: 'progress',
        ...progress,
      });
    });
    self.postMessage({
      type: 'result',
      schedule,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
    });
  }
};
