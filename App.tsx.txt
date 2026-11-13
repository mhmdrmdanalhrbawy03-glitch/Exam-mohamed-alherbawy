import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  type User,
} from 'firebase/auth'
import {
  collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, where, writeBatch,
} from 'firebase/firestore'
import {
  BookOpen, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Plus, Users,
  Clock3, FileQuestion, X, ShieldCheck, AlertCircle,
} from 'lucide-react'
import { auth, db, isFirebaseConfigured } from './firebase';

type Role = 'admin' | 'teacher' | 'student'
type Exam = {
  id: string; title: string; subject: string; grade: string; duration: number
  status: 'draft' | 'published'; questionCount?: number; createdAt?: unknown
}
type Question = {
  id: string; type: 'mcq' | 'essay'; text: string; options?: string[]
  correctAnswer?: number; points: number
}

type Tab = 'overview' | 'exams' | 'students' | 'questions'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<Role>('student')
  const [profileReady, setProfileReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [exams, setExams] = useState<Exam[]>([])
  const [studentsCount, setStudentsCount] = useState(0)
  const [showExamForm, setShowExamForm] = useState(false)
  const [examTitle, setExamTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [duration, setDuration] = useState(60)
  const [questionText, setQuestionText] = useState('')
  const [questionType, setQuestionType] = useState<'mcq' | 'essay'>('mcq')
  const [options, setOptions] = useState(['', '', '', ''])
  const [correctAnswer, setCorrectAnswer] = useState(0)
  const [points, setPoints] = useState(1)
  const [questions, setQuestions] = useState<Question[]>([])
  const [savingExam, setSavingExam] = useState(false)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      setProfileReady(false)
      if (!nextUser || !db) { setProfileReady(true); return }
      try {
        const profileRef = doc(db, 'users', nextUser.uid)
        const profile = await getDoc(profileRef)
        if (!profile.exists()) {
          await setDoc(profileRef, {
            uid: nextUser.uid, email: nextUser.email ?? '', fullName: nextUser.displayName ?? '',
            role: 'student', createdAt: serverTimestamp(),
          })
          setRole('student')
        } else {
          setRole((profile.data().role as Role) || 'student')
        }
      } catch {
        setMessage('تعذر تحميل ملف المستخدم. راجع إعدادات Firestore وقواعد الأمان.')
      } finally { setProfileReady(true) }
    })
  }, [])

  useEffect(() => {
    if (!user || !db) { setExams([]); return }
    const examsQuery = role === 'admin' || role === 'teacher'
      ? query(collection(db, 'exams'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'exams'), where('status', '==', 'published'))
    return onSnapshot(examsQuery, (snapshot) => {
      setExams(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Exam)))
    }, () => setMessage('تعذر تحميل الامتحانات. تأكد من نشر قواعد Firestore.'))
  }, [user, role])

  useEffect(() => {
    if (!user || !db || (role !== 'admin' && role !== 'teacher')) return
    return onSnapshot(query(collection(db, 'users'), where('role', '==', 'student')), snap => setStudentsCount(snap.size))
  }, [user, role])

  const isStaff = role === 'admin' || role === 'teacher'
  const nav = useMemo(() => [
    { id: 'overview' as const, label: 'الرئيسية', icon: LayoutDashboard },
    { id: 'exams' as const, label: 'الامتحانات', icon: ClipboardList },
    ...(isStaff ? [{ id: 'questions' as const, label: 'بنك الأسئلة', icon: BookOpen }, { id: 'students' as const, label: 'الطلاب', icon: Users }] : []),
  ], [isStaff])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    if (!auth) return
    setBusy(true); setMessage('')
    try { await signInWithEmailAndPassword(auth, email.trim(), password) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تسجيل الدخول') }
    finally { setBusy(false) }
  }

  async function handleRegister() {
    if (!auth || !fullName.trim()) { setMessage('اكتب الاسم بالكامل أولًا.'); return }
    setBusy(true); setMessage('')
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
      if (db) await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid, email: credential.user.email ?? '', fullName: fullName.trim(),
        role: 'student', createdAt: serverTimestamp(),
      })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر إنشاء الحساب') }
    finally { setBusy(false) }
  }

  async function saveExam(e: FormEvent) {
    e.preventDefault()
    if (!db || !isStaff) return
    if (!examTitle.trim() || !subject.trim() || !grade.trim() || questions.length === 0) {
      setMessage('أكمل بيانات الامتحان وأضف سؤالًا واحدًا على الأقل.'); return
    }
    setSavingExam(true); setMessage('')
    try {
      // Keep answer keys out of student-readable exam documents.
      const examRef = doc(collection(db, 'exams'))
      const batch = writeBatch(db)
      const studentQuestions = questions.map((question) => ({
        id: question.id,
        type: question.type,
        text: question.text,
        ...(question.options ? { options: question.options } : {}),
        points: question.points,
      }))
      const answerKey = Object.fromEntries(
        questions
          .filter((question) => question.type === 'mcq' && question.correctAnswer !== undefined)
          .map((question) => [question.id, question.correctAnswer]),
      )
      batch.set(examRef, {
        title: examTitle.trim(), subject: subject.trim(), grade: grade.trim(), duration,
        status: 'draft', questions: studentQuestions, questionCount: questions.length,
        createdBy: user?.uid, createdAt: serverTimestamp(),
      })
      batch.set(doc(db, 'examAnswerKeys', examRef.id), {
        answers: answerKey, createdBy: user?.uid, createdAt: serverTimestamp(),
      })
      await batch.commit()
      setShowExamForm(false); setExamTitle(''); setSubject(''); setGrade('')
      setDuration(60); setQuestions([]); setQuestionText('')
      setMessage('تم إنشاء الامتحان كمسودة. يمكنك نشره بعد مراجعته.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حفظ الامتحان') }
    finally { setSavingExam(false) }
  }

  function addQuestion() {
    if (!questionText.trim()) { setMessage('اكتب نص السؤال.'); return }
    if (questionType === 'mcq' && options.some(o => !o.trim())) { setMessage('أكمل الاختيارات الأربعة.'); return }
    setQuestions(old => [...old, {
      id: crypto.randomUUID(), type: questionType, text: questionText.trim(),
      ...(questionType === 'mcq' ? { options, correctAnswer } : {}), points,
    }])
    setQuestionText(''); setOptions(['', '', '', ''])
  }

  async function changeExamStatus(exam: Exam) {
    if (!db || !isStaff) return
    try {
      const { updateDoc } = await import('firebase/firestore')
      await updateDoc(doc(db, 'exams', exam.id), { status: exam.status === 'published' ? 'draft' : 'published' })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحديث حالة الامتحان') }
  }

  if (!isFirebaseConfigured) return <SetupScreen />
  if (!user) return (
    <main className="setup-screen">
      <form className="login-card" onSubmit={handleLogin}>
        <div className="brand-mark"><GraduationCap size={30} /></div>
        <p className="eyebrow">منصة تعليمية متكاملة</p><h1>منصة الحرباوي للامتحانات</h1>
        <p className="muted">سجّل الدخول أو أنشئ حساب طالب جديد.</p>
        <label>الاسم بالكامل <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="يُطلب عند إنشاء حساب جديد" /></label>
        <label>البريد الإلكتروني<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>كلمة المرور<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></label>
        {message && <p className="message">{message}</p>}
        <button className="primary full" disabled={busy}>{busy ? 'جارٍ التنفيذ...' : 'تسجيل الدخول'}</button>
        <button type="button" className="secondary full" onClick={handleRegister} disabled={busy}>إنشاء حساب طالب</button>
        <p className="small">إنشاء الحساب من هذه الصفحة يمنح دور طالب فقط.</p>
      </form>
    </main>
  )
  if (!profileReady) return <main className="setup-screen"><div className="setup-card">جارٍ تحميل حسابك...</div></main>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand"><div className="brand-mark"><GraduationCap /></div><div><b>الحرباوي</b><small>منصة الامتحانات</small></div></div>
        <div className="role-badge"><ShieldCheck size={15} />{role === 'admin' ? 'مدير المنصة' : role === 'teacher' ? 'مدرس' : 'طالب'}</div>
        <nav>{nav.map(item => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}><Icon size={19} />{item.label}</button> })}</nav>
        <button className="logout" onClick={() => auth && signOut(auth)}><LogOut size={18} /> تسجيل الخروج</button>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><span className="eyebrow">{isStaff ? 'لوحة الإدارة' : 'مساحة الطالب'}</span><h1>{nav.find(n => n.id === tab)?.label}</h1></div><div className="user-chip">{user.email}</div></header>
        {message && <div className="notice-inline"><AlertCircle size={17}/>{message}<button onClick={() => setMessage('')} aria-label="إغلاق"><X size={16}/></button></div>}
        {tab === 'overview' && <>
          <section className="welcome"><div><p className="eyebrow">لوحة التحكم</p><h2>أهلًا بك في منصة الامتحانات</h2><p>إدارة الامتحانات والأسئلة والطلاب من مكان واحد.</p></div><GraduationCap size={76} /></section>
          <section className="stats">
            <article className="stat-card"><span>الامتحانات المتاحة</span><strong>{exams.length}</strong><small>امتحانات ظاهرة لحسابك</small></article>
            <article className="stat-card"><span>الطلاب</span><strong>{isStaff ? studentsCount : '—'}</strong><small>{isStaff ? 'عدد حسابات الطلاب' : 'إحصائية خاصة بالإدارة'}</small></article>
            <article className="stat-card"><span>دور الحساب</span><strong className="role-value">{role === 'admin' ? 'مدير' : role === 'teacher' ? 'مدرس' : 'طالب'}</strong><small>حسب الصلاحيات المسجلة</small></article>
          </section>
          <section className="panel"><h3>ابدأ من القائمة الجانبية</h3><p>{isStaff ? 'أنشئ امتحانًا جديدًا وأضف أسئلة اختيار من متعدد أو أسئلة مقالية.' : 'افتح قسم الامتحانات لمشاهدة الامتحانات المنشورة.'}</p></section>
        </>}
        {tab === 'exams' && <section className="panel">
          <div className="section-heading"><div><h2>الامتحانات</h2><p>الامتحانات المنشورة للطلاب ومسودات الإدارة.</p></div>
          {isStaff && <button className="primary action-btn" onClick={() => setShowExamForm(true)}><Plus size={17}/> إنشاء امتحان</button>}</div>
          <div className="exam-list">{exams.map(exam => <article className="exam-card" key={exam.id}>
            <div className="exam-icon"><ClipboardList/></div><div className="exam-info"><b>{exam.title}</b><span>{exam.subject} · {exam.grade}</span><small><Clock3 size={13}/> {exam.duration} دقيقة <FileQuestion size={13}/> {exam.questionCount ?? 0} سؤال</small></div>
            <span className={exam.status === 'published' ? 'status published' : 'status draft'}>{exam.status === 'published' ? 'منشور' : 'مسودة'}</span>
            {isStaff && <button className="text-btn" onClick={() => changeExamStatus(exam)}>{exam.status === 'published' ? 'إلغاء النشر' : 'نشر'}</button>}
          </article>)}
          {exams.length === 0 && <div className="empty-state">لا توجد امتحانات حتى الآن.</div>}</div>
        </section>}
        {tab === 'questions' && <section className="panel"><h2>بنك الأسئلة</h2><p>إضافة الأسئلة حاليًا تتم داخل نموذج إنشاء الامتحان، وسنضيف بنكًا مستقلًا في المرحلة التالية.</p></section>}
        {tab === 'students' && <section className="panel"><h2>إدارة الطلاب</h2><p>عدد حسابات الطلاب المسجلة: <b>{studentsCount}</b></p><p>إدارة الملفات وتعيين المدرسين ستكون ضمن المرحلة التالية.</p></section>}
        <footer>إدارة وإشراف: محمد رمضان الحرباوي</footer>
      </main>

      {showExamForm && <div className="modal-backdrop"><form className="exam-modal" onSubmit={saveExam}>
        <div className="modal-heading"><div><p className="eyebrow">إدارة الامتحانات</p><h2>إنشاء امتحان جديد</h2></div><button type="button" className="icon-btn" onClick={() => setShowExamForm(false)}><X/></button></div>
        <div className="form-grid">
          <label>اسم الامتحان<input value={examTitle} onChange={e => setExamTitle(e.target.value)} required placeholder="مثال: امتحان الوحدة الأولى"/></label>
          <label>المادة<input value={subject} onChange={e => setSubject(e.target.value)} required placeholder="اللغة العربية"/></label>
          <label>الصف الدراسي<input value={grade} onChange={e => setGrade(e.target.value)} required placeholder="الصف الثاني الثانوي"/></label>
          <label>المدة بالدقائق<input type="number" min="1" max="300" value={duration} onChange={e => setDuration(Number(e.target.value))} required/></label>
        </div>
        <div className="question-builder">
          <h3>إضافة سؤال</h3>
          <div className="inline-fields"><label>نوع السؤال<select value={questionType} onChange={e => setQuestionType(e.target.value as 'mcq'|'essay')}><option value="mcq">اختيار من متعدد</option><option value="essay">مقالي</option></select></label><label>الدرجة<input type="number" min="1" value={points} onChange={e => setPoints(Number(e.target.value))}/></label></div>
          <label>نص السؤال<textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={2} placeholder="اكتب السؤال هنا..."/></label>
          {questionType === 'mcq' && <div className="options-grid">{options.map((option, i) => <label key={i}>الاختيار {i+1}<input value={option} onChange={e => setOptions(old => old.map((v, idx) => idx === i ? e.target.value : v))}/></label>)}<label>الإجابة الصحيحة<select value={correctAnswer} onChange={e => setCorrectAnswer(Number(e.target.value))}>{options.map((_, i) => <option key={i} value={i}>الاختيار {i+1}</option>)}</select></label></div>}
          <button type="button" className="secondary" onClick={addQuestion}><Plus size={16}/> إضافة السؤال للقائمة</button>
          <p className="small">الأسئلة المضافة: {questions.length}</p>
          {questions.map((q, i) => <div className="question-chip" key={q.id}>{i+1}. {q.type === 'mcq' ? 'اختياري' : 'مقالي'} — {q.text} ({q.points} درجة)</div>)}
        </div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowExamForm(false)}>إلغاء</button><button className="primary" disabled={savingExam}>{savingExam ? 'جارٍ الحفظ...' : 'حفظ الامتحان كمسودة'}</button></div>
      </form></div>}
    </div>
  )
}

function SetupScreen() {
  return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><GraduationCap size={30}/></div><p className="eyebrow">منصة تعليمية متكاملة</p><h1>منصة الحرباوي للامتحانات</h1><p className="muted">ملفات Firebase جاهزة، وينقصها إدخال إعدادات مشروعك.</p><div className="notice">أنشئ ملف <code>.env</code> في المجلد الرئيسي، وانسخ إليه القيم الموجودة في <code>.env.example</code> بعد استبدال القيم ببيانات Firebase Web App.</div><p className="small">بعد ذلك أعد تشغيل المشروع بالأمر <code>npm run dev</code>.</p></div></main>
}
