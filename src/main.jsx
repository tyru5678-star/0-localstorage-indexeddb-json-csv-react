import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  CalendarDays,
  Check,
  ClipboardList,
  Copy,
  Home,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'teacher-schedule-helper-v1';
const STORAGE_HISTORY_KEY = 'teacher-schedule-helper-history-v1';
const BACKUP_VERSION = 1;
const MAX_STORAGE_HISTORY = 10;

const defaultData = {
  settings: {
    classCount: 6,
    periodsByDay: {
      mon: 6,
      tue: 6,
      wed: 5,
      thu: 6,
      fri: 5,
    },
  },
  teachers: [],
  teacherAvailability: {},
  subjects: [],
  assignments: [],
  weeklyPlans: [],
};

const dayLabels = {
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
};

const teacherTypes = ['전담 교사', '외부 강사'];

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadSavedData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { data: defaultData, loadFailed: false };
    return { data: { ...defaultData, ...JSON.parse(saved) }, loadFailed: false };
  } catch {
    return { data: defaultData, loadFailed: true };
  }
}

function useLocalStorageData() {
  const initialLoad = React.useRef(loadSavedData());
  const [data, setData] = React.useState(initialLoad.current.data);
  const [storageStatus, setStorageStatus] = React.useState(
    initialLoad.current.loadFailed ? 'loadFailed' : 'checking'
  );

  React.useEffect(() => {
    if (initialLoad.current.loadFailed) return;
    try {
      saveRecoverySnapshot(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setStorageStatus('saved');
    } catch {
      setStorageStatus('blocked');
    }
  }, [data]);

  const updateData = (section, value) => {
    initialLoad.current.loadFailed = false;
    setData((current) => ({
      ...current,
      [section]: typeof value === 'function' ? value(current[section]) : value,
    }));
  };

  return [data, updateData, storageStatus];
}

function saveRecoverySnapshot(data) {
  const serialized = JSON.stringify(data);
  const rawHistory = localStorage.getItem(STORAGE_HISTORY_KEY);
  const history = rawHistory ? JSON.parse(rawHistory) : [];
  const latest = history[0];

  if (latest?.data === serialized) return;

  const nextHistory = [
    {
      savedAt: new Date().toISOString(),
      data: serialized,
    },
    ...history,
  ].slice(0, MAX_STORAGE_HISTORY);

  localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(nextHistory));
}

function loadRecoveryHistory() {
  try {
    const rawHistory = localStorage.getItem(STORAGE_HISTORY_KEY);
    if (!rawHistory) return [];
    return JSON.parse(rawHistory)
      .map((entry) => ({
        savedAt: entry.savedAt,
        data: JSON.parse(entry.data),
      }))
      .filter((entry) => entry.data?.settings && Array.isArray(entry.data?.teachers));
  } catch {
    return [];
  }
}

function App() {
  const [activePage, setActivePage] = React.useState('home');
  const [data, updateData, storageStatus] = useLocalStorageData();

  const pages = {
    home: <HomePage data={data} updateData={updateData} setActivePage={setActivePage} storageStatus={storageStatus} />,
    plans: <WeeklyPlansPage data={data} updateData={updateData} />,
    settings: <SettingsPage settings={data.settings} updateData={updateData} />,
    teachers: <TeachersPage data={data} updateData={updateData} />,
    subjects: <SubjectsPage subjects={data.subjects} updateData={updateData} />,
    assignments: <AssignmentsPage data={data} updateData={updateData} />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>시간표 도우미</strong>
            <small>정적 웹앱</small>
          </div>
        </div>
        <nav className="nav-list">
          <NavButton icon={<Home size={18} />} label="홈" page="home" activePage={activePage} onClick={setActivePage} />
          <NavButton icon={<CalendarDays size={18} />} label="주간 계획" page="plans" activePage={activePage} onClick={setActivePage} />
          <NavButton icon={<Settings size={18} />} label="기초 설정" page="settings" activePage={activePage} onClick={setActivePage} />
          <NavButton icon={<Users size={18} />} label="교사 관리" page="teachers" activePage={activePage} onClick={setActivePage} />
          <NavButton icon={<BookOpen size={18} />} label="교과 관리" page="subjects" activePage={activePage} onClick={setActivePage} />
          <NavButton icon={<ClipboardList size={18} />} label="교과 배정" page="assignments" activePage={activePage} onClick={setActivePage} />
        </nav>
      </aside>
      <main className="content">{pages[activePage]}</main>
    </div>
  );
}

function NavButton({ icon, label, page, activePage, onClick }) {
  return (
    <button className={activePage === page ? 'nav-button active' : 'nav-button'} onClick={() => onClick(page)}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function PageHeader({ title, description }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function HomePage({ data, updateData, setActivePage, storageStatus }) {
  const recentPlans = [...data.weeklyPlans].slice(-3).reverse();
  const recoveryHistory = loadRecoveryHistory();
  const importInputRef = React.useRef(null);
  const storageMessage = {
    loadFailed: '저장된 데이터를 읽지 못해 자동 저장을 멈췄습니다. 기존 데이터를 덮어쓰지 않도록 보호 중입니다.',
    checking: '저장 상태를 확인하는 중입니다.',
    saved: '입력한 데이터가 이 브라우저에 저장되고 있습니다.',
    blocked: '브라우저가 저장을 막고 있습니다. 시크릿 창이나 저장소 차단 설정을 확인해주세요.',
  };

  const exportBackup = () => {
    const backup = {
      app: 'teacher-schedule-helper',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `시간표도우미-백업-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const importedData = parsed.data || parsed;

        if (!importedData.settings || !Array.isArray(importedData.teachers)) {
          alert('백업 파일 형식이 맞지 않습니다.');
          return;
        }

        updateData('settings', { ...defaultData.settings, ...importedData.settings });
        updateData('teachers', importedData.teachers || []);
        updateData('teacherAvailability', importedData.teacherAvailability || {});
        updateData('subjects', importedData.subjects || []);
        updateData('assignments', importedData.assignments || []);
        updateData('weeklyPlans', importedData.weeklyPlans || []);
        alert('백업 파일을 불러왔습니다.');
      } catch {
        alert('JSON 파일을 읽을 수 없습니다.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const restoreRecoverySnapshot = (snapshot) => {
    if (!confirm('이전 자동 저장 상태로 되돌릴까요? 현재 상태는 새 자동 저장으로 남습니다.')) return;
    updateData('settings', { ...defaultData.settings, ...snapshot.settings });
    updateData('teachers', snapshot.teachers || []);
    updateData('teacherAvailability', snapshot.teacherAvailability || {});
    updateData('subjects', snapshot.subjects || []);
    updateData('assignments', snapshot.assignments || []);
    updateData('weeklyPlans', snapshot.weeklyPlans || []);
  };

  return (
    <>
      <PageHeader title="홈" description="전담 교사와 외부 강사 시간표를 만들기 위한 기본 데이터를 준비합니다." />
      <section className="home-grid">
        <div className="panel action-panel">
          <div>
            <h2>새 주간 계획</h2>
            <p>주 시작일을 정하고 새 계획을 추가합니다.</p>
          </div>
          <button className="primary-button" onClick={() => setActivePage('plans')}>
            <Plus size={18} />
            계획 만들기
          </button>
        </div>
        <div className="panel">
          <h2>기초 설정</h2>
          <p className={storageStatus === 'blocked' ? 'status-text danger' : 'status-text'}>
            {storageMessage[storageStatus]}
          </p>
          <dl className="summary-list">
            <div>
              <dt>학급 수</dt>
              <dd>{data.settings.classCount}개</dd>
            </div>
            <div>
              <dt>요일별 교시</dt>
              <dd>월~금 설정됨</dd>
            </div>
          </dl>
          <button className="text-button" onClick={() => setActivePage('settings')}>설정 수정</button>
        </div>
        <div className="panel">
          <h2>최근 시간표</h2>
          {recentPlans.length === 0 ? (
            <EmptyState text="아직 만든 주간 계획이 없습니다." />
          ) : (
            <ul className="simple-list">
              {recentPlans.map((plan) => (
                <li key={plan.id}>{plan.startDate}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h2>구글 시트 연동 또는 내보내기</h2>
          <p className="muted">현재는 JSON 백업을 저장하고 다시 불러올 수 있습니다.</p>
          <div className="button-row">
            <button className="secondary-button" onClick={exportBackup}>JSON 백업 저장</button>
            <button className="secondary-button" onClick={() => importInputRef.current?.click()}>JSON 백업 불러오기</button>
          </div>
          <input
            ref={importInputRef}
            className="hidden-input"
            type="file"
            accept="application/json,.json"
            onChange={importBackup}
          />
        </div>
        <div className="panel">
          <h2>자동 저장 복구</h2>
          <p className="muted">이전 자동 저장본을 최대 10개까지 보관합니다.</p>
          {recoveryHistory.length === 0 ? (
            <EmptyState text="아직 복구할 자동 저장본이 없습니다." />
          ) : (
            <ul className="simple-list recovery-list">
              {recoveryHistory.slice(0, 5).map((entry) => (
                <li key={entry.savedAt}>
                  <span>{formatRecoveryTime(entry.savedAt)}</span>
                  <button className="text-button" onClick={() => restoreRecoverySnapshot(entry.data)}>복구</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function formatRecoveryTime(isoString) {
  return new Date(isoString).toLocaleString('ko-KR');
}

function SettingsPage({ settings, updateData }) {
  const updateClassCount = (value) => {
    updateData('settings', {
      ...settings,
      classCount: Number(value),
    });
  };

  const updatePeriod = (day, value) => {
    updateData('settings', {
      ...settings,
      periodsByDay: {
        ...settings.periodsByDay,
        [day]: Number(value),
      },
    });
  };

  return (
    <>
      <PageHeader title="기초 설정" description="학급 수와 월~금 요일별 교시 수를 저장합니다." />
      <section className="panel form-panel">
        <label>
          학급 수
          <input type="number" min="1" value={settings.classCount} onChange={(event) => updateClassCount(event.target.value)} />
        </label>
        <div className="day-grid">
          {Object.entries(dayLabels).map(([day, label]) => (
            <label key={day}>
              {label}요일 교시 수
              <input
                type="number"
                min="0"
                value={settings.periodsByDay[day]}
                onChange={(event) => updatePeriod(day, event.target.value)}
              />
            </label>
          ))}
        </div>
      </section>
    </>
  );
}

function TeachersPage({ data, updateData }) {
  const { teachers, teacherAvailability, settings } = data;
  const blankTeacher = { name: '', type: '전담 교사', active: true };
  const [form, setForm] = React.useState(blankTeacher);
  const [editingId, setEditingId] = React.useState(null);
  const [selectedTeacherId, setSelectedTeacherId] = React.useState('');

  const saveTeacher = (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;

    if (editingId) {
      updateData('teachers', teachers.map((teacher) => (teacher.id === editingId ? { ...teacher, ...form } : teacher)));
    } else {
      updateData('teachers', [...teachers, { id: createId(), ...form }]);
    }

    setForm(blankTeacher);
    setEditingId(null);
  };

  return (
    <>
      <PageHeader title="교사 관리" description="전담 교사와 외부 강사를 등록하고 활성화 여부를 관리합니다." />
      <CrudForm onSubmit={saveTeacher} buttonText={editingId ? '교사 수정' : '교사 추가'}>
        <label>
          교사 이름
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="예: 김하늘" />
        </label>
        <label>
          유형
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {teacherTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <ToggleLabel checked={form.active} onChange={(checked) => setForm({ ...form, active: checked })} />
      </CrudForm>
      <ItemList
        items={teachers}
        emptyText="등록된 교사가 없습니다."
        renderItem={(teacher) => (
          <>
            <div>
              <strong>{teacher.name}</strong>
              <span>{teacher.type} · {teacher.active ? '활성' : '비활성'}</span>
            </div>
            <RowActions
              onEdit={() => {
                setEditingId(teacher.id);
                setForm({ name: teacher.name, type: teacher.type, active: teacher.active });
              }}
              onDelete={() => {
                updateData('teachers', teachers.filter((item) => item.id !== teacher.id));
                updateData('teacherAvailability', removeObjectKey(teacherAvailability, teacher.id));
                if (selectedTeacherId === teacher.id) setSelectedTeacherId('');
              }}
            />
          </>
        )}
      />
      <TeacherAvailabilityPanel
        teachers={teachers}
        settings={settings}
        teacherAvailability={teacherAvailability}
        selectedTeacherId={selectedTeacherId}
        setSelectedTeacherId={setSelectedTeacherId}
        updateData={updateData}
      />
    </>
  );
}

function removeObjectKey(object, keyToRemove) {
  const next = { ...object };
  delete next[keyToRemove];
  return next;
}

function createDefaultSlots(settings) {
  return Object.fromEntries(
    Object.keys(dayLabels).map((day) => [
      day,
      Array.from({ length: settings.periodsByDay[day] }, (_, index) => index + 1),
    ])
  );
}

function createEmptySlots() {
  return Object.fromEntries(Object.keys(dayLabels).map((day) => [day, []]));
}

function getTeacherSlots(teacherAvailability, teacherId, settings) {
  return {
    ...createDefaultSlots(settings),
    ...(teacherAvailability[teacherId] || {}),
  };
}

function getCommonTeacherSlots(teacherAvailability, teacherIds, settings) {
  const defaultSlots = createDefaultSlots(settings);
  if (teacherIds.length === 0) return defaultSlots;

  return Object.fromEntries(
    Object.keys(dayLabels).map((day) => {
      const commonPeriods = defaultSlots[day].filter((period) =>
        teacherIds.every((teacherId) => getTeacherSlots(teacherAvailability, teacherId, settings)[day]?.includes(period))
      );
      return [day, commonPeriods];
    })
  );
}

function createPlanAssignment(assignment, data) {
  return {
    id: createId(),
    sourceAssignmentId: assignment.id,
    subjectId: assignment.subjectId,
    teacherIds: assignment.teacherIds,
    weeklyHours: assignment.weeklyHours,
    classNumbers: assignment.classNumbers,
    availableSlots: getCommonTeacherSlots(data.teacherAvailability, assignment.teacherIds, data.settings),
    continuous: false,
    active: assignment.active,
  };
}

function createPlanFromCurrentSettings(startDate, data) {
  return {
    id: createId(),
    startDate,
    memo: '',
    planAssignments: data.assignments
      .filter((assignment) => assignment.active)
      .map((assignment) => createPlanAssignment(assignment, data)),
    oneTimeLessons: [],
  };
}

function copyWeeklyPlan(plan) {
  const copyDate = addDaysToDate(plan.startDate, 7);
  return {
    ...structuredClone(plan),
    id: createId(),
    startDate: copyDate,
    planAssignments: (plan.planAssignments || []).map((assignment) => ({
      ...structuredClone(assignment),
      id: createId(),
    })),
    oneTimeLessons: (plan.oneTimeLessons || []).map((lesson) => ({
      ...structuredClone(lesson),
      id: createId(),
    })),
    generatedSchedule: undefined,
  };
}

function addDaysToDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function TeacherAvailabilityPanel({
  teachers,
  settings,
  teacherAvailability,
  selectedTeacherId,
  setSelectedTeacherId,
  updateData,
}) {
  const activeTeachers = teachers.filter((teacher) => teacher.active);
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId);

  React.useEffect(() => {
    if (!selectedTeacherId && activeTeachers.length > 0) {
      setSelectedTeacherId(activeTeachers[0].id);
    }
  }, [activeTeachers, selectedTeacherId, setSelectedTeacherId]);

  const isAvailable = (day, period) => {
    const teacherData = teacherAvailability[selectedTeacherId];
    if (!teacherData) return true;
    const dayData = teacherData[day];
    if (!dayData) return true;
    return dayData.includes(period);
  };

  const toggleAvailability = (day, period) => {
    if (!selectedTeacherId) return;

    const currentTeacherData = teacherAvailability[selectedTeacherId] || {};
    const maxPeriods = settings.periodsByDay[day];
    const currentDayData = currentTeacherData[day] || Array.from({ length: maxPeriods }, (_, index) => index + 1);
    const nextDayData = currentDayData.includes(period)
      ? currentDayData.filter((item) => item !== period)
      : [...currentDayData, period].sort((a, b) => a - b);

    updateData('teacherAvailability', {
      ...teacherAvailability,
      [selectedTeacherId]: {
        ...currentTeacherData,
        [day]: nextDayData,
      },
    });
  };

  const setAllAvailable = () => {
    if (!selectedTeacherId) return;

    const allAvailable = Object.fromEntries(
      Object.keys(dayLabels).map((day) => [
        day,
        Array.from({ length: settings.periodsByDay[day] }, (_, index) => index + 1),
      ])
    );

    updateData('teacherAvailability', {
      ...teacherAvailability,
      [selectedTeacherId]: allAvailable,
    });
  };

  const setAllUnavailable = () => {
    if (!selectedTeacherId) return;

    const allUnavailable = Object.fromEntries(Object.keys(dayLabels).map((day) => [day, []]));

    updateData('teacherAvailability', {
      ...teacherAvailability,
      [selectedTeacherId]: allUnavailable,
    });
  };

  return (
    <section className="panel availability-panel">
      <div className="section-heading">
        <div>
          <h2>교사별 수업 가능 시간</h2>
          <p>자동 시간표 생성 전에 교사가 수업할 수 있는 시간을 체크합니다.</p>
        </div>
        <select value={selectedTeacherId} onChange={(event) => setSelectedTeacherId(event.target.value)}>
          <option value="">교사 선택</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
          ))}
        </select>
      </div>

      {!selectedTeacher ? (
        <EmptyState text="먼저 교사를 등록해주세요." />
      ) : (
        <>
          <div className="button-row">
            <button className="secondary-button" onClick={setAllAvailable}>전체 가능</button>
            <button className="secondary-button" onClick={setAllUnavailable}>전체 불가능</button>
          </div>
          <SlotTable
            settings={settings}
            slots={getTeacherSlots(teacherAvailability, selectedTeacherId, settings)}
            onToggle={toggleAvailability}
          />
        </>
      )}
    </section>
  );
}

function SubjectsPage({ subjects, updateData }) {
  const blankSubject = { name: '', color: '#2f80ed', active: true };
  const [form, setForm] = React.useState(blankSubject);
  const [editingId, setEditingId] = React.useState(null);

  const saveSubject = (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;

    if (editingId) {
      updateData('subjects', subjects.map((subject) => (subject.id === editingId ? { ...subject, ...form } : subject)));
    } else {
      updateData('subjects', [...subjects, { id: createId(), ...form }]);
    }

    setForm(blankSubject);
    setEditingId(null);
  };

  return (
    <>
      <PageHeader title="교과 관리" description="과목명, 색상, 활성화 여부를 관리합니다." />
      <CrudForm onSubmit={saveSubject} buttonText={editingId ? '교과 수정' : '교과 추가'}>
        <label>
          과목명
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="예: 음악" />
        </label>
        <label>
          색상
          <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
        </label>
        <ToggleLabel checked={form.active} onChange={(checked) => setForm({ ...form, active: checked })} />
      </CrudForm>
      <ItemList
        items={subjects}
        emptyText="등록된 교과가 없습니다."
        renderItem={(subject) => (
          <>
            <div>
              <strong><span className="color-dot" style={{ background: subject.color }} />{subject.name}</strong>
              <span>{subject.active ? '활성' : '비활성'}</span>
            </div>
            <RowActions
              onEdit={() => {
                setEditingId(subject.id);
                setForm({ name: subject.name, color: subject.color, active: subject.active });
              }}
              onDelete={() => updateData('subjects', subjects.filter((item) => item.id !== subject.id))}
            />
          </>
        )}
      />
    </>
  );
}

function AssignmentsPage({ data, updateData }) {
  const blankAssignment = { subjectId: '', teacherIds: [], weeklyHours: 1, classNumbers: [], active: true };
  const [form, setForm] = React.useState(blankAssignment);
  const [editingId, setEditingId] = React.useState(null);

  const classNumbers = Array.from({ length: data.settings.classCount }, (_, index) => index + 1);

  const saveAssignment = (event) => {
    event.preventDefault();
    if (!form.subjectId || form.teacherIds.length === 0) return;

    if (editingId) {
      updateData('assignments', data.assignments.map((item) => (item.id === editingId ? { ...item, ...form } : item)));
    } else {
      updateData('assignments', [...data.assignments, { id: createId(), ...form }]);
    }

    setForm(blankAssignment);
    setEditingId(null);
  };

  const toggleArrayValue = (field, value) => {
    const nextValues = form[field].includes(value)
      ? form[field].filter((item) => item !== value)
      : [...form[field], value];
    setForm({ ...form, [field]: nextValues });
  };

  const getSubjectName = (id) => data.subjects.find((subject) => subject.id === id)?.name || '교과 없음';
  const getSubjectColor = (id) => data.subjects.find((subject) => subject.id === id)?.color || '#e8f1ff';
  const getTeacherNames = (ids) => ids.map((id) => data.teachers.find((teacher) => teacher.id === id)?.name).filter(Boolean).join(', ');

  return (
    <>
      <PageHeader title="교과 배정" description="교과별 담당 교사, 기본 주당 차시, 담당 학급을 설정합니다." />
      <CrudForm onSubmit={saveAssignment} buttonText={editingId ? '배정 수정' : '배정 추가'}>
        <label>
          교과목
          <select value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })}>
            <option value="">선택하세요</option>
            {data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
        <label>
          기본 주당 차시
          <input type="number" min="1" value={form.weeklyHours} onChange={(event) => setForm({ ...form, weeklyHours: Number(event.target.value) })} />
        </label>
        <CheckboxGroup
          title="담당 교사"
          options={data.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))}
          selected={form.teacherIds}
          onToggle={(value) => toggleArrayValue('teacherIds', value)}
        />
        <CheckboxGroup
          title="담당 학급"
          options={classNumbers.map((number) => ({ value: number, label: `${number}반` }))}
          selected={form.classNumbers}
          onToggle={(value) => toggleArrayValue('classNumbers', value)}
          onSelectAll={(classNumbers) => setForm({ ...form, classNumbers })}
        />
        <ToggleLabel checked={form.active} onChange={(checked) => setForm({ ...form, active: checked })} />
      </CrudForm>
      <ItemList
        items={data.assignments}
        emptyText="등록된 교과 배정이 없습니다."
        renderItem={(assignment) => (
          <>
            <div>
              <strong>{getSubjectName(assignment.subjectId)}</strong>
              <span>{getTeacherNames(assignment.teacherIds)} · 주 {assignment.weeklyHours}차시 · {assignment.classNumbers.join(', ')}반 · {assignment.active ? '활성' : '비활성'}</span>
            </div>
            <RowActions
              onEdit={() => {
                setEditingId(assignment.id);
                setForm({
                  subjectId: assignment.subjectId,
                  teacherIds: assignment.teacherIds,
                  weeklyHours: assignment.weeklyHours,
                  classNumbers: assignment.classNumbers,
                  active: assignment.active,
                });
              }}
              onDelete={() => updateData('assignments', data.assignments.filter((item) => item.id !== assignment.id))}
            />
          </>
        )}
      />
    </>
  );
}

function WeeklyPlansPage({ data, updateData }) {
  const { weeklyPlans: plans } = data;
  const [startDate, setStartDate] = React.useState('');
  const [editingDateId, setEditingDateId] = React.useState('');
  const [editingDateValue, setEditingDateValue] = React.useState('');
  const [selectedPlanId, setSelectedPlanId] = React.useState('');
  const [selectedPlanMode, setSelectedPlanMode] = React.useState('setup');

  const savePlan = (event) => {
    event.preventDefault();
    if (!startDate) return;

    const newPlan = createPlanFromCurrentSettings(startDate, data);
    updateData('weeklyPlans', [...plans, newPlan]);
    setSelectedPlanId(newPlan.id);
    setSelectedPlanMode('setup');

    setStartDate('');
  };

  const updatePlan = (planId, updater) => {
    updateData('weeklyPlans', plans.map((plan) => (plan.id === planId ? updater(plan) : plan)));
  };

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const savePlanDate = (planId) => {
    if (!editingDateValue) return;
    updateData('weeklyPlans', plans.map((plan) => (plan.id === planId ? { ...plan, startDate: editingDateValue } : plan)));
    setEditingDateId('');
    setEditingDateValue('');
  };
  const copyPlan = (plan) => {
    const copiedPlan = copyWeeklyPlan(plan);
    updateData('weeklyPlans', [...plans, copiedPlan]);
    setSelectedPlanId(copiedPlan.id);
    setSelectedPlanMode('setup');
  };

  return (
    <>
      <PageHeader title="주간 계획" description="주 시작일 기준으로 주간 계획 목록을 관리합니다." />
      <CrudForm onSubmit={savePlan} buttonText="새 계획 생성">
        <label>
          주 시작일
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
      </CrudForm>
      <ItemList
        items={plans}
        emptyText="등록된 주간 계획이 없습니다."
        renderItem={(plan) => (
          <>
            <div>
              <div className="plan-date-row">
                {editingDateId === plan.id ? (
                  <>
                    <input type="date" value={editingDateValue} onChange={(event) => setEditingDateValue(event.target.value)} />
                    <button className="icon-button" type="button" onClick={() => savePlanDate(plan.id)} aria-label="날짜 저장">
                      <Check size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <strong>{plan.startDate}</strong>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => {
                        setEditingDateId(plan.id);
                        setEditingDateValue(plan.startDate);
                      }}
                      aria-label="날짜 수정"
                    >
                      <Pencil size={15} />
                    </button>
                  </>
                )}
              </div>
              <span>교과별 차시, 가능 시간, 연차시, 담당 학급을 이 주 계획에서 조정합니다.</span>
            </div>
            <div className="row-actions wide">
              <button onClick={() => {
                setSelectedPlanId(plan.id);
                setSelectedPlanMode('setup');
              }}>주간 설정</button>
              <button
                disabled={!plan.generatedSchedule}
                onClick={() => {
                  setSelectedPlanId(plan.id);
                  setSelectedPlanMode('view');
                }}
              >
                시간표 보기
              </button>
              <button onClick={() => copyPlan(plan)}>
                <Copy size={16} />
                복사
              </button>
              <button className="icon-danger" onClick={() => updateData('weeklyPlans', plans.filter((item) => item.id !== plan.id))} aria-label="삭제">
                <Trash2 size={16} />
              </button>
            </div>
          </>
        )}
      />
      {selectedPlan ? (
        selectedPlanMode === 'view' && selectedPlan.generatedSchedule ? (
          <SavedSchedulePanel
            plan={selectedPlan}
            settings={data.settings}
            onBackToSetup={() => setSelectedPlanMode('setup')}
          />
        ) : (
          <WeeklyPlanSetup
            plan={selectedPlan}
            data={data}
            updatePlan={(updater) => updatePlan(selectedPlan.id, updater)}
          />
        )
      ) : null}
    </>
  );
}

function WeeklyPlanSetup({ plan, data, updatePlan }) {
  const planAssignments = plan.planAssignments || [];
  const oneTimeLessons = plan.oneTimeLessons || [];
  const [oneTimeModal, setOneTimeModal] = React.useState('');
  const [selectedDetailId, setSelectedDetailId] = React.useState('');
  const [setupStep, setSetupStep] = React.useState('basic');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [generationMessage, setGenerationMessage] = React.useState('');
  const [generationProgress, setGenerationProgress] = React.useState({
    percent: 0,
    searched: 0,
  });
  const [draftSchedule, setDraftSchedule] = React.useState(null);
  const generationWorkerRef = React.useRef(null);
  const blankLesson = {
    name: '',
    teacherName: '',
    color: '#e8f1ff',
    weeklyHours: 1,
    classNumbers: [],
    availableSlots: createEmptySlots(),
    slotCapacities: {},
    continuous: false,
    flexiblePlacement: false,
    active: true,
  };
  const [lessonForm, setLessonForm] = React.useState(blankLesson);

  const classNumbers = Array.from({ length: data.settings.classCount }, (_, index) => index + 1);
  const getSubjectName = (id) => data.subjects.find((subject) => subject.id === id)?.name || '교과 없음';
  const getSubjectColor = (id) => data.subjects.find((subject) => subject.id === id)?.color || '#e8f1ff';
  const getTeacherNames = (ids) => ids.map((id) => data.teachers.find((teacher) => teacher.id === id)?.name).filter(Boolean).join(', ');
  const detailItems = [
    ...planAssignments.map((assignment) => ({
      kind: 'assignment',
      id: assignment.id,
      title: getSubjectName(assignment.subjectId),
      subtitle: getTeacherNames(assignment.teacherIds),
      color: getSubjectColor(assignment.subjectId),
      item: assignment,
    })),
    ...oneTimeLessons.map((lesson) => ({
      kind: 'oneTime',
      id: lesson.id,
      title: lesson.name,
      subtitle: lesson.teacherName || '외부강사 미정',
      color: lesson.color || '#e8f1ff',
      item: lesson,
    })),
  ];
  const activeDetailItems = detailItems.filter((detailItem) => detailItem.item.active !== false);

  React.useEffect(() => {
    if (!selectedDetailId && activeDetailItems.length > 0) {
      setSelectedDetailId(activeDetailItems[0].id);
    }
    if (selectedDetailId && activeDetailItems.length > 0 && !activeDetailItems.some((detailItem) => detailItem.id === selectedDetailId)) {
      setSelectedDetailId(activeDetailItems[0].id);
    }
    if (activeDetailItems.length === 0 && selectedDetailId) {
      setSelectedDetailId('');
    }
  }, [activeDetailItems, selectedDetailId]);

  React.useEffect(() => {
    setSetupStep('basic');
    setDraftSchedule(null);
  }, [plan.id]);

  React.useEffect(
    () => () => {
      generationWorkerRef.current?.terminate();
      generationWorkerRef.current = null;
    },
    []
  );

  const updatePlanAssignment = (assignmentId, patch) => {
    updatePlan((currentPlan) => ({
      ...currentPlan,
      planAssignments: (currentPlan.planAssignments || []).map((assignment) =>
        assignment.id === assignmentId ? { ...assignment, ...patch } : assignment
      ),
      generatedSchedule: undefined,
    }));
    setDraftSchedule(null);
  };

  const deletePlanAssignment = (assignmentId) => {
    updatePlan((currentPlan) => ({
      ...currentPlan,
      planAssignments: (currentPlan.planAssignments || []).filter((assignment) => assignment.id !== assignmentId),
      generatedSchedule: undefined,
    }));
    setDraftSchedule(null);
  };

  const updateOneTimeLesson = (lessonId, patch) => {
    updatePlan((currentPlan) => ({
      ...currentPlan,
      oneTimeLessons: (currentPlan.oneTimeLessons || []).map((lesson) =>
        lesson.id === lessonId ? { ...lesson, ...patch } : lesson
      ),
      generatedSchedule: undefined,
    }));
    setDraftSchedule(null);
  };

  const deleteOneTimeLesson = (lessonId) => {
    updatePlan((currentPlan) => ({
      ...currentPlan,
      oneTimeLessons: (currentPlan.oneTimeLessons || []).filter((lesson) => lesson.id !== lessonId),
      generatedSchedule: undefined,
    }));
    setDraftSchedule(null);
  };

  const addOneTimeLesson = (event) => {
    event.preventDefault();
    if (!lessonForm.name.trim()) return;

    updatePlan((currentPlan) => ({
      ...currentPlan,
      oneTimeLessons: [...(currentPlan.oneTimeLessons || []), { ...lessonForm, teacherName: lessonForm.teacherName.trim(), id: createId() }],
      generatedSchedule: undefined,
    }));
    setLessonForm(blankLesson);
  };

  const selectedDetailItem = activeDetailItems.find((detailItem) => detailItem.id === selectedDetailId);

  const updateDetailItem = (detailItem, patch) => {
    if (detailItem.kind === 'assignment') {
      updatePlanAssignment(detailItem.id, patch);
    } else {
      updateOneTimeLesson(detailItem.id, patch);
    }
  };

  const handleGenerateSchedule = () => {
    generationWorkerRef.current?.terminate();
    setIsGenerating(true);
    setGenerationProgress({ percent: 0, searched: 0 });
    setGenerationMessage('가능한 시간표 조합을 확인하는 중입니다...');

    const worker = new Worker(new URL('./scheduler.worker.js', import.meta.url), { type: 'module' });
    generationWorkerRef.current = worker;

    worker.onmessage = (event) => {
      if (event.data.type === 'progress') {
        setGenerationMessage(event.data.message);
        setGenerationProgress({
          percent: event.data.percent ?? 0,
          searched: event.data.searched ?? 0,
        });
        return;
      }

      if (event.data.type === 'result') {
        setDraftSchedule(event.data.schedule);
        setSetupStep('result');
        setIsGenerating(false);
        worker.terminate();
        generationWorkerRef.current = null;
        return;
      }

      if (event.data.type === 'error') {
        setGenerationMessage(`오류가 발생했습니다: ${event.data.message}`);
        alert(`시간표 생성 중 오류가 발생했습니다.\n${event.data.message}`);
        setIsGenerating(false);
        worker.terminate();
        generationWorkerRef.current = null;
      }
    };

    worker.onerror = (error) => {
      console.error(error);
      setGenerationMessage(`오류가 발생했습니다: ${error.message}`);
      alert(`시간표 생성 중 오류가 발생했습니다.\n${error.message}`);
      setIsGenerating(false);
      worker.terminate();
      generationWorkerRef.current = null;
    };

    worker.postMessage({
      plan,
      detailItems: activeDetailItems,
      settings: data.settings,
    });
  };

  const saveGeneratedSchedule = () => {
    if (!draftSchedule) return;
    updatePlan((currentPlan) => ({ ...currentPlan, generatedSchedule: draftSchedule }));
  };

  return (
    <section className={isGenerating ? 'plan-setup generating' : 'plan-setup'}>
      <div className="section-heading">
        <div>
          <h2>{plan.startDate} 주간 설정</h2>
          <p>
            {setupStep === 'basic'
              ? '기본 교과 배정을 복사해온 값입니다. 여기서 바꾸는 내용은 이 주에만 적용됩니다.'
              : setupStep === 'detail'
                ? '교과/교사별로 자동 배치에 사용할 차시 순서를 정합니다.'
                : '생성된 시간표를 학급별 또는 교과/교사별로 확인합니다.'}
          </p>
        </div>
        {setupStep === 'basic' ? (
          <button className="primary-button" type="button" onClick={() => setSetupStep('detail')} disabled={activeDetailItems.length === 0}>
            다음 단계
          </button>
        ) : setupStep === 'detail' ? (
          <div className="step-actions">
            <button className="secondary-button" type="button" onClick={() => setSetupStep('basic')}>
              이전 단계
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={handleGenerateSchedule}
              disabled={isGenerating}
            >
              {isGenerating ? '생성 중...' : '시간표 생성'}
            </button>
          </div>
        ) : (
          <div className="step-actions">
            <button className="secondary-button" type="button" onClick={() => setSetupStep('detail')}>
              이전 단계
            </button>
            <button className="primary-button" type="button" onClick={handleGenerateSchedule} disabled={isGenerating}>
              {isGenerating ? '생성 중...' : '다시 생성'}
            </button>
            <button className="primary-button" type="button" onClick={saveGeneratedSchedule} disabled={!draftSchedule}>
              시간표 저장
            </button>
          </div>
        )}
      </div>

      {setupStep === 'basic' ? (
        <>
          <div className="setup-grid">
            {planAssignments.length === 0 ? (
              <EmptyState text="이 계획에 들어온 교과 배정이 없습니다. 먼저 교과 배정을 등록해주세요." />
            ) : (
              planAssignments.map((assignment) => (
                <PlanAssignmentCard
                  key={assignment.id}
                  title={getSubjectName(assignment.subjectId)}
                  subtitle={getTeacherNames(assignment.teacherIds)}
                  item={assignment}
                  classNumbers={classNumbers}
                  settings={data.settings}
                  onChange={(patch) => updatePlanAssignment(assignment.id, patch)}
                  onDelete={() => deletePlanAssignment(assignment.id)}
                />
              ))
            )}
          </div>

          {oneTimeLessons.length > 0 ? (
            <div className="setup-grid">
              {oneTimeLessons.map((lesson) => (
                <PlanAssignmentCard
                  key={lesson.id}
                  title={lesson.name}
                  subtitle={lesson.teacherName || '외부강사 미정'}
                  item={lesson}
                  showColor
                  classNumbers={classNumbers}
                  settings={data.settings}
                  onChange={(patch) => updateOneTimeLesson(lesson.id, patch)}
                  onDelete={() => deleteOneTimeLesson(lesson.id)}
                />
              ))}
            </div>
          ) : null}

          <form className="panel one-time-form" onSubmit={addOneTimeLesson}>
            <h2>일회성 외부강사 수업 추가</h2>
            <div className="form-grid compact">
              <label>
                수업명
                <input value={lessonForm.name} onChange={(event) => setLessonForm({ ...lessonForm, name: event.target.value })} placeholder="예: 안전교육" />
              </label>
              <label>
                강사명
                <input value={lessonForm.teacherName} onChange={(event) => setLessonForm({ ...lessonForm, teacherName: event.target.value })} placeholder="예: 박강사" />
              </label>
              <label className="lesson-color-control">
                색상
                <input type="color" value={lessonForm.color} onChange={(event) => setLessonForm({ ...lessonForm, color: event.target.value })} />
              </label>
              <label>
                해당 주 차시 수
                <input type="number" min="1" value={lessonForm.weeklyHours} onChange={(event) => setLessonForm({ ...lessonForm, weeklyHours: Number(event.target.value) })} />
              </label>
            </div>
            <div className="inline-controls">
              <ToggleLabel checked={lessonForm.continuous} onChange={(checked) => setLessonForm({ ...lessonForm, continuous: checked })} label="연차시 여부" />
              <ToggleLabel checked={lessonForm.flexiblePlacement} onChange={(checked) => setLessonForm({ ...lessonForm, flexiblePlacement: checked })} label="빈 시간에만 배치" />
              <button className="secondary-button" type="button" onClick={() => setOneTimeModal('classes')}>
                학급 {formatClassSummary(lessonForm.classNumbers)}
              </button>
              <button className="secondary-button" type="button" onClick={() => setOneTimeModal('slots')}>
                가능 시간 {formatSlotsSummary(lessonForm.availableSlots)}
              </button>
              <button className="primary-button" type="submit">
                <Plus size={18} />
                추가
              </button>
            </div>
          </form>
        </>
      ) : null}

      {oneTimeModal === 'classes' ? (
        <Modal title="일회성 수업 담당 학급" onClose={() => setOneTimeModal('')}>
          <CheckboxGroup
            title="담당 학급"
            options={classNumbers.map((number) => ({ value: number, label: `${number}반` }))}
            selected={lessonForm.classNumbers}
            onToggle={(value) => setLessonForm({ ...lessonForm, classNumbers: toggleValue(lessonForm.classNumbers, value) })}
            onSelectAll={(classNumbers) => setLessonForm({ ...lessonForm, classNumbers })}
          />
        </Modal>
      ) : null}

      {oneTimeModal === 'slots' ? (
        <Modal title="일회성 수업 가능 시간" onClose={() => setOneTimeModal('')}>
          <ParallelSlotEditor
            title="시간별 동시 수업 가능 반 수"
            settings={data.settings}
            slotCapacities={lessonForm.slotCapacities || {}}
            onChange={(slotCapacities) => setLessonForm({
              ...lessonForm,
              slotCapacities,
              availableSlots: capacitiesToSlots(slotCapacities, data.settings),
            })}
          />
        </Modal>
      ) : null}

      {setupStep === 'detail' && activeDetailItems.length > 0 ? (
        <section className="panel detail-panel">
          <div className="detail-tabs" role="tablist" aria-label="세부 설정 교과 선택">
            {activeDetailItems.map((detailItem) => (
              <button
                key={detailItem.id}
                className={selectedDetailId === detailItem.id ? 'detail-tab active' : 'detail-tab'}
                onClick={() => setSelectedDetailId(detailItem.id)}
                type="button"
              >
                <strong>{detailItem.title}</strong>
                <span>{detailItem.subtitle || '담당자 없음'}</span>
              </button>
            ))}
          </div>
          {selectedDetailItem ? (
            <DetailStageTable
              title={selectedDetailItem.title}
              subtitle={selectedDetailItem.subtitle}
              item={selectedDetailItem.item}
              settings={data.settings}
              onChange={(detailStages) => updateDetailItem(selectedDetailItem, { detailStages })}
              onFixedClassChange={(fixedClasses) => updateDetailItem(selectedDetailItem, { fixedClasses })}
            />
          ) : null}
        </section>
      ) : null}

      {setupStep === 'result' && draftSchedule ? (
        <GeneratedScheduleView schedule={draftSchedule} settings={data.settings} fileLabel={plan.startDate} />
      ) : null}

      {isGenerating ? (
        <div className="generation-overlay" role="status" aria-live="polite">
          <div className="generation-panel">
            <div className="spinner" />
            <strong>시간표 생성 중</strong>
            <p>{generationMessage}</p>
            <div className="generation-progress" aria-hidden="true">
              <span style={{ width: `${generationProgress.percent}%` }} />
            </div>
            <small>
              {generationProgress.searched
                ? `${generationProgress.searched.toLocaleString()}개 조합 확인`
                : '준비 중'}
            </small>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SavedSchedulePanel({ plan, settings, onBackToSetup }) {
  return (
    <section className="plan-setup">
      <div className="section-heading">
        <div>
          <h2>{plan.startDate} 저장된 시간표</h2>
          <p>저장한 시간표 결과를 확인합니다.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBackToSetup}>
          주간 설정으로
        </button>
      </div>
      <GeneratedScheduleView schedule={plan.generatedSchedule} settings={settings} fileLabel={plan.startDate} />
    </section>
  );
}

function PlanAssignmentCard({ title, subtitle, item, showColor = false, classNumbers, settings, onChange, onDelete }) {
  const [modal, setModal] = React.useState('');

  return (
    <article className="setup-row">
      <div className="setup-main">
        <div className="setup-title">
          <div className="setup-title-row">
            <h3>{title}</h3>
            {showColor ? (
              <button className="icon-button" type="button" onClick={() => setModal('name')} aria-label="교과명 수정">
                <Pencil size={15} />
              </button>
            ) : null}
          </div>
          <p>{subtitle || '담당자 없음'}</p>
        </div>
      </div>
      <div className="setup-controls">
        {showColor ? (
          <label className="lesson-color-control">
            색상
            <input type="color" value={item.color || '#e8f1ff'} onChange={(event) => onChange({ color: event.target.value })} />
          </label>
        ) : null}
        <label>
          차시
          <input type="number" min="1" value={item.weeklyHours} onChange={(event) => onChange({ weeklyHours: Number(event.target.value) })} />
        </label>
        <ToggleLabel checked={item.continuous} onChange={(checked) => onChange({ continuous: checked })} label="연차시 여부" />
        {showColor ? (
          <ToggleLabel checked={Boolean(item.flexiblePlacement)} onChange={(checked) => onChange({ flexiblePlacement: checked })} label="빈 시간에만 배치" />
        ) : null}
        <ToggleLabel checked={item.active} onChange={(checked) => onChange({ active: checked })} />
        <button className="secondary-button" onClick={() => setModal('classes')}>
          학급 {formatClassSummary(item.classNumbers)}
        </button>
        <button className="secondary-button" onClick={() => setModal('slots')}>
          가능 시간 {formatSlotsSummary(item.availableSlots)}
        </button>
        <button className="icon-danger row-delete" onClick={onDelete} aria-label="삭제">
          <Trash2 size={16} />
        </button>
      </div>

      {modal === 'name' ? (
        <Modal title="교과명 수정" onClose={() => setModal('')}>
          <label className="modal-field">
            교과명
            <input value={item.name || ''} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
        </Modal>
      ) : null}

      {modal === 'classes' ? (
        <Modal title={`${title} 담당 학급`} onClose={() => setModal('')}>
          <CheckboxGroup
            title="담당 학급"
            options={classNumbers.map((number) => ({ value: number, label: `${number}반` }))}
            selected={item.classNumbers}
            onToggle={(value) => onChange({ classNumbers: toggleValue(item.classNumbers, value) })}
            onSelectAll={(classNumbers) => onChange({ classNumbers })}
          />
        </Modal>
      ) : null}

      {modal === 'slots' ? (
        <Modal title={`${title} 수업 가능 시간`} onClose={() => setModal('')}>
          {showColor ? (
            <ParallelSlotEditor
              title="시간별 동시 수업 가능 반 수"
              settings={settings}
              slotCapacities={item.slotCapacities || slotsToCapacities(item.availableSlots)}
              onChange={(slotCapacities) => onChange({
                slotCapacities,
                availableSlots: capacitiesToSlots(slotCapacities, settings),
              })}
            />
          ) : (
            <SlotEditor
              title="수업 가능 시간"
              settings={settings}
              slots={item.availableSlots}
              onChange={(availableSlots) => onChange({ availableSlots })}
            />
          )}
        </Modal>
      ) : null}
    </article>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="secondary-button" onClick={onClose}>닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DetailStageTable({ title, subtitle, item, settings, onChange, onFixedClassChange }) {
  const stages = item.detailStages || createDefaultDetailStages(item, settings);
  const fixedClasses = item.fixedClasses || {};
  const [fixedSlotKey, setFixedSlotKey] = React.useState('');
  const maxPeriods = Math.max(...Object.values(settings.periodsByDay));
  const totalNeeded = (item.classNumbers?.length || 0) * Number(item.weeklyHours || 0);
  const availableCount = countAvailableSlots(item.availableSlots);

  const cycleStage = (day, period) => {
    const key = createSlotKey(day, period);
    const currentStage = stages[key] || 0;
    const nextStage = currentStage >= item.weeklyHours ? 0 : currentStage + 1;
    const nextStages = { ...stages };

    if (nextStage === 0) {
      delete nextStages[key];
    } else {
      nextStages[key] = nextStage;
    }

    onChange(nextStages);
  };

  const setFixedClass = (classNumber) => {
    const nextFixedClasses = { ...fixedClasses };

    if (!classNumber) {
      delete nextFixedClasses[fixedSlotKey];
    } else {
      nextFixedClasses[fixedSlotKey] = classNumber;
    }

    onFixedClassChange(nextFixedClasses);
    setFixedSlotKey('');
  };

  const fixedSlotLabel = fixedSlotKey ? formatSlotKey(fixedSlotKey) : '';

  return (
    <div className="detail-stage">
      <div className="detail-summary">
        <div>
          <h3>{title}</h3>
          <p>{subtitle || '담당자 없음'}</p>
        </div>
        <span>
          {formatClassSummary(item.classNumbers)} · 주 {item.weeklyHours}차시 · 필요 {totalNeeded}칸 · 가능 {availableCount}칸
        </span>
      </div>
      <div className="slot-table-wrap">
        <table className="slot-table stage-table">
          <thead>
            <tr>
              <th>교시</th>
              {Object.values(dayLabels).map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxPeriods }, (_, index) => index + 1).map((period) => (
              <tr key={period}>
                <th>{period}교시</th>
                {Object.keys(dayLabels).map((day) => {
                  const isUsablePeriod = period <= settings.periodsByDay[day];
                  const isAvailable = (item.availableSlots?.[day] || []).includes(period);
                  const stage = stages[createSlotKey(day, period)];

                  return (
                    <td key={`${day}-${period}`}>
                      {isUsablePeriod && isAvailable ? (
                        <div className={stage ? `stage-cell stage-${stage}` : 'stage-cell empty'}>
                          <button type="button" className="stage-main-button" onClick={() => cycleStage(day, period)}>
                            <span>{stage ? `${stage}차시` : '비어 있음'}</span>
                            {fixedClasses[createSlotKey(day, period)] ? (
                              <small>{fixedClasses[createSlotKey(day, period)]}반 고정</small>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className="stage-menu-button"
                            onClick={() => setFixedSlotKey(createSlotKey(day, period))}
                            aria-label="반 고정 설정"
                          >
                            ...
                          </button>
                        </div>
                      ) : (
                        <span className="stage-cell disabled">{isUsablePeriod ? '불가' : '없음'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fixedSlotKey ? (
        <Modal title={`${fixedSlotLabel} 반 고정`} onClose={() => setFixedSlotKey('')}>
          <div className="fixed-class-picker">
            <button className="secondary-button" type="button" onClick={() => setFixedClass(null)}>
              고정 안 함
            </button>
            {(item.classNumbers || []).map((classNumber) => (
              <button
                key={classNumber}
                className={fixedClasses[fixedSlotKey] === classNumber ? 'primary-button' : 'secondary-button'}
                type="button"
                onClick={() => setFixedClass(classNumber)}
              >
                {classNumber}반 고정
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

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

function generateWeeklySchedule(plan, detailItems, settings) {
  const schedule = {
    generatedAt: new Date().toISOString(),
    generationVersion: '2026-05-17-multi-stage-swap-v6',
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
  const constructiveResult = constructHumanStylePlacements({
    tasks: balancedTasks,
    settings,
    totalClassCount: settings.classCount,
  });
  const flexiblePlacements = placeFlexibleTasks(flexibleTasks, constructiveResult.placements);
  const allPlacements = [...constructiveResult.placements, ...flexiblePlacements];
  schedule.lowLoadDays = constructiveResult.lowLoadDays;
  schedule.dayCapacity = constructiveResult.dayCapacity;
  applyPlacementsToSchedule(schedule, allPlacements);

  const placedTaskIds = new Set(allPlacements.map((placement) => placement.taskId));
  allTasks
    .filter((task) => !placedTaskIds.has(task.id))
    .forEach((task) => schedule.warnings.push(getUnplacedTaskWarning(task)));
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

function constructHumanStylePlacements({ tasks, settings, totalClassCount, useSparseSeed = true }) {
  if (tasks.some((task) => task.item.continuous)) {
    const continuousFirst = constructWithContinuousCandidates({
      tasks,
      settings,
      totalClassCount,
    });
    if (continuousFirst) return continuousFirst;
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
    });
    if (relaxedPlacements) {
      return {
        placements: relaxedPlacements,
        lowLoadDays,
        dayCapacity,
      };
    }
  }

  const balancedPlacements = rebalanceEqualCapacityDays(
    best?.placements || [],
    tasks,
    lowLoadDays,
    dayCapacity
  );
  const improvedPlacements = improvePlacementsBySameStageSwaps(
    balancedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity
  );
  const dayBalancedPlacements = improveDayBalanceBySameStageSwaps(
    improvedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity
  );
  const bundleBalancedPlacements = improveDayBalanceByMultiStageSwaps(
    dayBalancedPlacements,
    tasks,
    lowLoadDays,
    settings,
    dayCapacity
  );
  const finalPlacements = rebalanceEqualCapacityDays(
    bundleBalancedPlacements,
    tasks,
    lowLoadDays,
    dayCapacity
  );

  return {
    placements: finalPlacements,
    lowLoadDays,
    dayCapacity,
  };
}

function constructWithContinuousCandidates({ tasks, settings, totalClassCount }) {
  const continuousTasks = tasks.filter((task) => task.item.continuous);
  const regularTasks = tasks.filter((task) => !task.item.continuous);
  const continuousGroups = buildStageGroups(continuousTasks, [], new Set());
  const continuousAssignments = enumerateContinuousGroupCandidates(continuousGroups, 300);
  let best = null;

  for (const seedPlacements of continuousAssignments) {
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

function constructRelaxedContinuousFallback({ tasks, settings, totalClassCount }) {
  const regularTasks = tasks.filter((task) => !task.item.continuous);
  const continuousTasks = tasks.filter((task) => task.item.continuous);
  if (continuousTasks.length === 0) return null;

  const regularResult = constructHumanStylePlacements({
    tasks: regularTasks,
    settings,
    totalClassCount,
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

    return totalScore + dayScore + sameCapacityScore;
  }, 0);
}

function improvePlacementsBySameStageSwaps(placements, tasks, lowLoadDays, settings, dayCapacity) {
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

          if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays)) continue;

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

function improveDayBalanceBySameStageSwaps(placements, tasks, lowLoadDays, settings, dayCapacity) {
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
          if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays)) continue;

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

function improveDayBalanceByMultiStageSwaps(placements, tasks, lowLoadDays, settings, dayCapacity) {
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
            if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays)) continue;

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

function rebalanceEqualCapacityDays(placements, tasks, lowLoadDays, dayCapacity) {
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
            if (!allPlacementsRemainValid(candidatePlacements, lowLoadDays)) continue;

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

function allPlacementsRemainValid(placements, lowLoadDays) {
  const state = createPlacementState();

  for (const placement of placements) {
    if (!canUseCandidate(placement, state, lowLoadDays)) return false;
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

function GeneratedScheduleView({ schedule, settings, fileLabel = '시간표' }) {
  const variants = schedule.variants?.length ? schedule.variants : [schedule];
  const [selectedVariantIndex, setSelectedVariantIndex] = React.useState(0);
  const visibleSchedule = variants[selectedVariantIndex] || schedule;
  const [viewMode, setViewMode] = React.useState('class');
  const classEntries = Object.entries(visibleSchedule.classSchedules).sort(([a], [b]) => Number(a) - Number(b));
  const itemEntries = Object.entries(visibleSchedule.itemSchedules);
  const [selectedClass, setSelectedClass] = React.useState(classEntries[0]?.[0] || '');
  const [selectedItem, setSelectedItem] = React.useState(itemEntries[0]?.[0] || '');

  React.useEffect(() => {
    if (!selectedClass && classEntries.length > 0) setSelectedClass(classEntries[0][0]);
    if (!selectedItem && itemEntries.length > 0) setSelectedItem(itemEntries[0][0]);
  }, [classEntries, itemEntries, selectedClass, selectedItem]);

  const selectedClassSchedule = classEntries.find(([classNumber]) => classNumber === selectedClass);
  const selectedItemSchedule = itemEntries.find(([itemId]) => itemId === selectedItem);

  return (
    <section className="panel generated-panel">
      <div className="section-heading compact-heading">
        <div>
          <h2>생성된 시간표</h2>
          <p>학급별 시간표와 교과/교사별 시간표를 확인합니다. 생성 시각: {formatDateTime(schedule.generatedAt)}</p>
          {visibleSchedule.generationVersion ? (
            <p>생성 로직: {visibleSchedule.generationVersion}</p>
          ) : null}
          {visibleSchedule.lowLoadDays?.length ? (
            <p>중복 반 금지 요일: {visibleSchedule.lowLoadDays.map((day) => `${dayLabels[day]}요일`).join(', ')}</p>
          ) : null}
        </div>
        <button className="primary-button" type="button" onClick={() => exportScheduleWorkbook(schedule, settings, fileLabel)}>
          엑셀 내보내기
        </button>
      </div>
      {variants.length > 1 ? (
        <div className="selector-row" aria-label="시간표 안 선택">
          {variants.map((variant, index) => (
            <button
              key={`${variant.variantName || index}-${index}`}
              className={selectedVariantIndex === index ? 'selector-button active' : 'selector-button'}
              type="button"
              onClick={() => setSelectedVariantIndex(index)}
            >
              {variant.variantName || `${index + 1}안`}
            </button>
          ))}
        </div>
      ) : null}
      {visibleSchedule.warnings.length > 0 ? (
        <div className="warning-box">
          {visibleSchedule.warnings.map((warning, index) => (
            <p key={`${warning}-${index}`}>{warning}</p>
          ))}
        </div>
      ) : null}

      <div className="result-tabs" role="tablist" aria-label="시간표 보기 방식">
        <button className={viewMode === 'class' ? 'result-tab active' : 'result-tab'} type="button" onClick={() => setViewMode('class')}>
          학급별 시간표
        </button>
        <button className={viewMode === 'item' ? 'result-tab active' : 'result-tab'} type="button" onClick={() => setViewMode('item')}>
          교사별 시간표
        </button>
      </div>

      {viewMode === 'class' ? (
        <>
          <div className="selector-row" aria-label="학급 선택">
            {classEntries.map(([classNumber]) => (
              <button
                key={classNumber}
                className={selectedClass === classNumber ? 'selector-button active' : 'selector-button'}
                type="button"
                onClick={() => setSelectedClass(classNumber)}
              >
                {classNumber}반
              </button>
            ))}
          </div>
          {selectedClassSchedule ? (
            <MiniScheduleTable title={`${selectedClassSchedule[0]}반`} slots={selectedClassSchedule[1]} settings={settings} mode="class" />
          ) : (
            <EmptyState text="생성된 학급 시간표가 없습니다." />
          )}
        </>
      ) : (
        <>
          <div className="selector-row" aria-label="교과 또는 교사 선택">
            {itemEntries.map(([itemId, itemSchedule]) => (
              <button
                key={itemId}
                className={selectedItem === itemId ? 'selector-button active' : 'selector-button'}
                type="button"
                onClick={() => setSelectedItem(itemId)}
              >
                {itemSchedule.title}
              </button>
            ))}
          </div>
          {selectedItemSchedule ? (
          <MiniScheduleTable
            title={selectedItemSchedule[1].title}
            subtitle={selectedItemSchedule[1].subtitle}
            slots={selectedItemSchedule[1].slots}
            settings={settings}
            mode="item"
          />
          ) : (
            <EmptyState text="생성된 교사별 시간표가 없습니다." />
          )}
        </>
      )}
    </section>
  );
}

async function exportScheduleWorkbook(schedule, settings, fileLabel) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const classEntries = Object.entries(schedule.classSchedules).sort(([a], [b]) => Number(a) - Number(b));
  const itemEntries = Object.entries(schedule.itemSchedules);
  const usedSheetNames = new Set();

  classEntries.forEach(([classNumber, slots]) => {
    const rows = buildScheduleRows(slots, settings, (entry) => entry.title);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(`${classNumber}반`, usedSheetNames));
  });

  itemEntries.forEach(([, itemSchedule], index) => {
    const rows = buildScheduleRows(itemSchedule.slots, settings, (entry) =>
      Array.isArray(entry) ? entry.map((item) => item.classNumber).join(', ') : entry.classNumber
    );
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const title = itemSchedule.subtitle ? `${itemSchedule.title}-${itemSchedule.subtitle}` : itemSchedule.title;
    XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(title, usedSheetNames, index));
  });

  XLSX.writeFile(workbook, `${fileLabel}-시간표.xlsx`);
}

function buildScheduleRows(slots, settings, formatEntry) {
  const maxPeriods = Math.max(...Object.values(settings.periodsByDay));
  const rows = [['교시', ...Object.values(dayLabels)]];

  for (let period = 1; period <= maxPeriods; period += 1) {
    rows.push([
      period,
      ...Object.keys(dayLabels).map((day) => {
        if (period > settings.periodsByDay[day]) return '';
        const entry = slots[createSlotKey(day, period)];
        return entry ? formatEntry(entry) : '';
      }),
    ]);
  }

  return rows;
}

function safeSheetName(name, fallbackIndex = 0) {
  const cleaned = (name || `교사${fallbackIndex + 1}`)
    .replace(/[\\/?*[\]:]/g, '')
    .slice(0, 31);
  return cleaned || `교사${fallbackIndex + 1}`;
}

function uniqueSheetName(name, usedSheetNames, fallbackIndex = 0) {
  const base = safeSheetName(name, fallbackIndex);
  let candidate = base;
  let suffix = 2;

  while (usedSheetNames.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  usedSheetNames.add(candidate);
  return candidate;
}

function MiniScheduleTable({ title, subtitle, slots, settings, mode }) {
  const maxPeriods = Math.max(...Object.values(settings.periodsByDay));

  return (
    <article className="mini-schedule">
      <h4>{title}</h4>
      {subtitle ? <p>{subtitle}</p> : null}
      <div className="slot-table-wrap">
        <table className="mini-table">
          <thead>
            <tr>
              <th>교시</th>
              {Object.values(dayLabels).map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxPeriods }, (_, index) => index + 1).map((period) => (
              <tr key={period}>
                <th>{period}</th>
                {Object.keys(dayLabels).map((day) => {
                  const entry = slots[createSlotKey(day, period)];
                  const usable = period <= settings.periodsByDay[day];
                  return (
                    <td key={`${day}-${period}`}>
                      {usable && entry ? (
                        <span
                          className="mini-entry"
                          style={getMiniEntryStyle(entry, mode)}
                        >
                          {mode === 'class'
                            ? entry.title
                            : (Array.isArray(entry) ? entry.map((item) => `${item.classNumber}반`).join(', ') : `${entry.classNumber}반`)}
                          <small>{Array.isArray(entry) ? `${entry[0].stage}차시` : `${entry.stage}차시`}</small>
                        </span>
                      ) : (
                        <span className="mini-empty">{usable ? '' : '-'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function getMiniEntryStyle(entry, mode) {
  const visibleEntry = Array.isArray(entry) ? entry[0] : entry;
  const baseColor = visibleEntry.color || '#e8f1ff';
  const background = mode === 'item'
    ? getStageTint(baseColor, visibleEntry.stage)
    : baseColor;

  return {
    background,
    color: getReadableTextColor(background),
  };
}

function getStageTint(hexColor, stage) {
  const amountByStage = {
    1: 0.34,
    2: -0.08,
    3: -0.28,
    4: -0.4,
  };
  return shiftHexLightness(hexColor, amountByStage[stage] ?? 0);
}

function shiftHexLightness(hexColor, amount) {
  const normalized = hexColor.replace('#', '');
  if (normalized.length !== 6) return hexColor;
  const channels = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
  const shifted = channels.map((channel) => {
    const target = amount >= 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  });
  return `#${shifted.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function getReadableTextColor(hexColor) {
  const normalized = hexColor.replace('#', '');
  if (normalized.length !== 6) return '#1f2937';
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness < 150 ? '#ffffff' : '#1f2937';
}

function SlotEditor({ title, settings, slots, onChange }) {
  const toggleSlot = (day, period) => {
    const daySlots = slots[day] || [];
    onChange({
      ...slots,
      [day]: toggleValue(daySlots, period).sort((a, b) => a - b),
    });
  };

  return (
    <fieldset className="slot-editor">
      <legend>{title}</legend>
      <SlotTable settings={settings} slots={slots} onToggle={toggleSlot} />
    </fieldset>
  );
}

function ParallelSlotEditor({ title, settings, slotCapacities, onChange }) {
  const maxPeriods = Math.max(...Object.values(settings.periodsByDay));
  const updateCapacity = (day, period, value) => {
    const key = createSlotKey(day, period);
    const capacity = Math.max(0, Number(value) || 0);
    const next = { ...slotCapacities };
    if (capacity > 0) next[key] = capacity;
    else delete next[key];
    onChange(next);
  };

  return (
    <fieldset className="slot-editor">
      <legend>{title}</legend>
      <div className="slot-table-wrap">
        <table className="slot-table">
          <thead>
            <tr>
              <th>교시</th>
              {Object.values(dayLabels).map((label) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxPeriods }, (_, index) => index + 1).map((period) => (
              <tr key={period}>
                <th>{period}교시</th>
                {Object.keys(dayLabels).map((day) => {
                  const usable = period <= settings.periodsByDay[day];
                  const key = createSlotKey(day, period);
                  return (
                    <td key={key}>
                      {usable ? (
                        <input
                          className="capacity-input"
                          type="number"
                          min="0"
                          value={slotCapacities[key] || 0}
                          onChange={(event) => updateCapacity(day, period, event.target.value)}
                        />
                      ) : (
                        <span className="slot-cell disabled">없음</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

function capacitiesToSlots(slotCapacities, settings) {
  const slots = Object.fromEntries(Object.keys(dayLabels).map((day) => [day, []]));
  Object.keys(dayLabels).forEach((day) => {
    for (let period = 1; period <= settings.periodsByDay[day]; period += 1) {
      if ((slotCapacities[createSlotKey(day, period)] || 0) > 0) slots[day].push(period);
    }
  });
  return slots;
}

function slotsToCapacities(slots = {}) {
  const capacities = {};
  Object.entries(slots).forEach(([day, periods]) => {
    periods.forEach((period) => {
      capacities[createSlotKey(day, period)] = 1;
    });
  });
  return capacities;
}

function SlotTable({ settings, slots, onToggle }) {
  const maxPeriods = Math.max(...Object.values(settings.periodsByDay));

  return (
    <div className="slot-table-wrap">
      <table className="slot-table">
        <thead>
          <tr>
            <th>교시</th>
            {Object.values(dayLabels).map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxPeriods }, (_, index) => index + 1).map((period) => (
            <tr key={period}>
              <th>{period}교시</th>
              {Object.keys(dayLabels).map((day) => {
                const isUsablePeriod = period <= settings.periodsByDay[day];
                const selected = (slots[day] || []).includes(period);

                return (
                  <td key={`${day}-${period}`}>
                    {isUsablePeriod ? (
                      <button
                        type="button"
                        className={selected ? 'slot-cell selected' : 'slot-cell'}
                        onClick={() => onToggle(day, period)}
                        aria-pressed={selected}
                      >
                        {selected ? '가능' : '불가'}
                      </button>
                    ) : (
                      <span className="slot-cell disabled">없음</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function formatClassSummary(classNumbers) {
  if (!classNumbers || classNumbers.length === 0) return '0개';
  return `${classNumbers.length}개`;
}

function formatSlotsSummary(slots) {
  if (!slots) return '0칸';
  const count = Object.values(slots).reduce((sum, periods) => sum + periods.length, 0);
  return `${count}칸`;
}

function CrudForm({ children, onSubmit, buttonText }) {
  return (
    <form className="panel form-grid" onSubmit={onSubmit}>
      {children}
      <button className="primary-button" type="submit">
        <Plus size={18} />
        {buttonText}
      </button>
    </form>
  );
}

function ToggleLabel({ checked, onChange, label = '활성화 여부' }) {
  return (
    <label className="toggle-row">
      {label}
      <button
        type="button"
        className={checked ? 'toggle active' : 'toggle'}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span>{checked ? <Check size={14} /> : null}</span>
      </button>
    </label>
  );
}

function CheckboxGroup({ title, options, selected, onToggle, onSelectAll }) {
  const allSelected = options.length > 0 && options.every((option) => selected.includes(option.value));

  return (
    <fieldset className="checkbox-group">
      <legend>
        {title}
        {onSelectAll && options.length > 0 ? (
          <button className="text-button checkbox-bulk-button" type="button" onClick={() => onSelectAll(allSelected ? [] : options.map((option) => option.value))}>
            {allSelected ? '전체 해제' : '전체 선택'}
          </button>
        ) : null}
      </legend>
      <div>
        {options.length === 0 ? (
          <span className="muted">먼저 항목을 등록해주세요.</span>
        ) : (
          options.map((option) => (
            <label key={option.value} className="check-pill">
              <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
              {option.label}
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
}

function ItemList({ items, emptyText, renderItem }) {
  if (items.length === 0) return <EmptyState text={emptyText} />;

  return (
    <section className="list-panel">
      {items.map((item) => (
        <article className="list-row" key={item.id}>
          {renderItem(item)}
        </article>
      ))}
    </section>
  );
}

function RowActions({ onEdit, onDelete }) {
  return (
    <div className="row-actions">
      <button onClick={onEdit}>수정</button>
      <button className="icon-danger" onClick={onDelete} aria-label="삭제">
        <Trash2 size={16} />
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
