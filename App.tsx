import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  type User,
} from 'firebase/auth'
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import {
  BookOpen, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Plus, Users,
  Clock3, FileQuestion, X, ShieldCheck, AlertCircle, Play, CheckCircle2, Trash2, Award,
} from 'lucide-react'
import { auth, db, isFirebaseConfigured } from './lib/firebase'

type Role = 'admin' | 'teacher' | 'student'
type Question = {
  id: string; type: 'mcq' | 'essay'; text: string; options?: string[]
  correctAnswer?: number; points: number
}
type Exam = {
  id: string; title: string; subject: string; grade: string; duration: number
  status: 'draft' | 'published'; questions?: Question[]; questionCount?: number; createdAt?: unknown
}
type Submission = {
  id: string; examId: string; examTitle: string; studentId: string; studentName: string; studentEmail: string
  score: number; totalPoints: number; status: 'graded' | 'pending_review'; submittedAt?: unknown
}
type StudentProfile = {
  uid: string; fullName: string; email: string; role: Role
}

type Tab = 'overview' | 'exams' | 'results' | 'students'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<StudentProfile | null>(null)
  const [role, setRole] = useState<Role>('student')
  const [profileReady, setProfileReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  // Data states
  const [exams, setExams] = useState<Exam[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [studentsList, setStudentsList] = useState<StudentProfile[]>([])

  // Create Exam Modal states
  const [showExamForm, setShowExamForm] = useState(false)
  const [examTitle, setExamTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [duration, setDuration] = useState(30)
  const [questionText, setQuestionText] = useState('')
  const [questionType, setQuestionType] = useState<'mcq' | 'essay'>('mcq')
  const [options, setOptions] = useState(['', '', '', ''])
  const [correctAnswer, setCorrectAnswer] = useState(0)
  const [points, setPoints] = useState(1)
  const [questions, setQuestions] = useState<Question[]>([])
  const [savingExam, setSavingExam] = useState(false)

  // Active Exam Taking states (for Students)
  const [activeExam, setActiveExam] = useState<Exam | null>(null)
  const [studentAnswers, setStudentAnswers] = useState<Record<string, number | string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const [submittingExam, setSubmittingExam] = useState(false)
  const [lastResult, setLastResult] = useState<{ score: number; total: number; pendingEssay: boolean } | null>(null)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      setProfileReady(false)
      if (!nextUser || !db) {
        setUserProfile(null)
        setProfileReady(true)
        return
      }
      try {
        const profileRef = doc(db, 'users', nextUser.uid)
        const profile = await getDoc(profileRef)
        if (!profile.exists()) {
          const newProf: StudentProfile = {
            uid: nextUser.uid,
            email: nextUser.email ?? '',
            fullName: nextUser.displayName || 'طالب جديد',
            role: 'student',
          }
          await setDoc(profileRef, { ...newProf, createdAt: serverTimestamp() })
          setUserProfile(newProf)
          setRole('student')
        } else {
          const data = profile.data() as StudentProfile
          setUserProfile(data)
          setRole(data.role || 'student')
        }
      } catch {
        setMessage('تعذر تحميل ملف المستخدم. تأكد من تفعيل Firestore وقواعد الأمان.')
      } finally {
        setProfileReady(true)
      }
    })
  }, [])

  const isStaff = role === 'admin' || role === 'teacher'

  // Load Exams
  useEffect(() => {
    if (!user || !db) { setExams([]); return }
    const examsQuery = isStaff
      ? query(collection(db, 'exams'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'exams'), where('status', '==', 'published'))
    return onSnapshot(examsQuery, (snapshot) => {
      setExams(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Exam)))
    }, () => setMessage('تعذر تحميل الامتحانات. تأكد من صلاحيات Firestore.'))
  }, [user, isStaff])

  // Load Submissions (Results)
  useEffect(() => {
    if (!user || !db) { setSubmissions([]); return }
    const subQuery = isStaff
      ? query(collection(db, 'submissions'), orderBy('submittedAt', 'desc'))
      : query(collection(db, 'submissions'), where('studentId', '==', user.uid))
    return onSnapshot(subQuery, (snapshot) => {
      setSubmissions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Submission)))
    }, () => {})
  }, [user, isStaff])

  // Load Students (For Staff)
  useEffect(() => {
    if (!user || !db || !isStaff) return
    return onSnapshot(query(collection(db, 'users'), where('role', '==', 'student')), snap => {
      setStudentsList(snap.docs.map(d => d.data() as StudentProfile))
    })
  }, [user, isStaff])

  // Countdown Timer for Active Exam
  useEffect(() => {
    if (!activeExam || timeLeft <= 0) return
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          handleFinishExam()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [activeExam, timeLeft])

  const nav = useMemo(() => [
    { id: 'overview' as const, label: 'الرئيسية', icon: LayoutDashboard },
    { id: 'exams' as const, label: 'الامتحانات', icon: ClipboardList },
    { id: 'results' as const, label: isStaff ? 'نتائج الطلاب' : 'درجاتي', icon: Award },
    ...(isStaff ? [{ id: 'students' as const, label: 'الطلاب', icon: Users }] : []),
  ], [isStaff])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    if (!auth) return
    setBusy(true); setMessage('')
    try { await signInWithEmailAndPassword(auth, email.trim(), password) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'بيانات الدخول غير صحيحة') }
    finally { setBusy(false) }
  }

  async function handleRegister() {
    if (!auth || !fullName.trim()) { setMessage('اكتب الاسم بالكامل أولًا.'); return }
    if (!email.trim() || password.length < 6) { setMessage('أدخل بريداً إلكترونياً صحيحاً وكلمة مرور 6 أحرف على الأقل.'); return }
    setBusy(true); setMessage('')
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
      if (db) {
        await setDoc(doc(db, 'users', credential.user.uid), {
          uid: credential.user.uid, email: credential.user.email ?? '', fullName: fullName.trim(),
          role: 'student', createdAt: serverTimestamp(),
        })
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر إنشاء الحساب') }
    finally { setBusy(false) }
  }

  function addQuestion() {
    if (!questionText.trim()) { setMessage('اكتب نص السؤال.'); return }
    if (questionType === 'mcq' && options.some(o => !o.trim())) { setMessage('أكمل الاختيارات الأربعة.'); return }
    setQuestions(old => [...old, {
      id: crypto.randomUUID(), type: questionType, text: questionText.trim(),
      ...(questionType === 'mcq' ? { options: [...options], correctAnswer } : {}), points,
    }])
    setQuestionText(''); setOptions(['', '', '', '']); setCorrectAnswer(0)
  }

  async function saveExam(e: FormEvent) {
    e.preventDefault()
    if (!db || !isStaff) return
    if (!examTitle.trim() || !subject.trim() || !grade.trim() || questions.length === 0) {
      setMessage('أكمل بيانات الامتحان وأضف سؤالًا واحدًا على الأقل.'); return
    }
    setSavingExam(true); setMessage('')
    try {
      const examRef = doc(collection(db, 'exams'))
      const batch = writeBatch(db)
      const studentQuestions = questions.map((q) => ({
        id: q.id,
        type: q.type,
        text: q.text,
        ...(q.options ? { options: q.options } : {}),
        points: q.points,
      }))
      const answerKey = Object.fromEntries(
        questions
          .filter((q) => q.type === 'mcq' && q.correctAnswer !== undefined)
          .map((q) => [q.id, q.correctAnswer]),
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
      setDuration(30); setQuestions([]); setQuestionText('')
      setMessage('تم حفظ الامتحان كمسودة. اضغط "نشر" ليظهر للطلاب.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حفظ الامتحان') }
    finally { setSavingExam(false) }
  }

  async function changeExamStatus(exam: Exam) {
    if (!db || !isStaff) return
    try {
      await updateDoc(doc(db, 'exams', exam.id), { status: exam.status === 'published' ? 'draft' : 'published' })
    } catch { setMessage('تعذر تحديث حالة الامتحان') }
  }

  async function deleteExam(examId: string) {
    if (!db || !isStaff) return
    try {
      await deleteDoc(doc(db, 'exams', examId))
      setMessage('تم حذف الامتحان.')
    } catch { setMessage('تعذر حذف الامتحان') }
  }

  function startExam(exam: Exam) {
    setActiveExam(exam)
    setStudentAnswers({})
    setLastResult(null)
    setTimeLeft(exam.duration * 60)
  }

  async function handleFinishExam() {
    if (!activeExam || !db || !user || submittingExam) return
    setSubmittingExam(true)
    try {
      const keySnap = await getDoc(doc(db, 'examAnswerKeys', activeExam.id))
      const answerKey: Record<string, number> = keySnap.exists() ? (keySnap.data().answers || {}) : {}

      let score = 0
      let totalPoints = 0
      let hasEssay = false

      for (const q of activeExam.questions || []) {
        totalPoints += q.points
        if (q.type === 'mcq') {
          if (studentAnswers[q.id] === answerKey[q.id]) {
            score += q.points
          }
        } else {
          hasEssay = true
        }
      }

      await addDoc(collection(db, 'submissions'), {
        examId: activeExam.id,
        examTitle: activeExam.title,
        studentId: user.uid,
        studentName: userProfile?.fullName || 'طالب',
        studentEmail: user.email || '',
        answers: studentAnswers,
        score,
        totalPoints,
        status: hasEssay ? 'pending_review' : 'graded',
        submittedAt: serverTimestamp(),
      })

      setLastResult({ score, total: totalPoints, pendingEssay: hasEssay })
      setActiveExam(null)
    } catch {
      setMessage('حدث خطأ أثناء تسليم الإجابات. تأكد من قواعد Firestore.')
    } finally {
      setSubmittingExam(false)
    }
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
      </form>
    </main>
  )
  if (!profileReady) return <main className="setup-screen"><div className="setup-card">جارٍ تحميل بيانات حسابك...</div></main>

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand"><div className="brand-mark"><GraduationCap /></div><div><b>الحرباوي</b><small>منصة الامتحانات</small></div></div>
        <div className="role-badge"><ShieldCheck size={15} />{role === 'admin' ? 'مدير المنصة' : role === 'teacher' ? 'مدرس' : 'طالب'}</div>
        <nav>{nav.map(item => { const Icon = item.icon; return <button key={item.id} className={tab === item.id && !activeExam ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveExam(null); setTab(item.id) }}><Icon size={19} />{item.label}</button> })}</nav>
        <button className="logout" onClick={() => auth && signOut(auth)}><LogOut size={18} /> تسجيل الخروج</button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div><span className="eyebrow">{isStaff ? 'لوحة الإدارة' : 'مساحة الطالب'}</span><h1>{activeExam ? activeExam.title : nav.find(n => n.id === tab)?.label}</h1></div>
          <div className="user-chip">{userProfile?.fullName} ({user.email})</div>
        </header>

        {message && <div className="notice-inline"><AlertCircle size={17}/>{message}<button onClick={() => setMessage('')} aria-label="إغلاق"><X size={16}/></button></div>}

        {lastResult && (
          <div className="score-banner">
            <CheckCircle2 size={36} style={{ marginBottom: 8 }} />
            <h2>تم تسليم الامتحان بنجاح!</h2>
            <p style={{ fontSize: 18, fontWeight: 800 }}>درجتك: {lastResult.score} من {lastResult.total}</p>
            {lastResult.pendingEssay && <small>يحتوي الامتحان على أسئلة مقالية سيراجعها المدرس لاحقًا.</small>}
            <div style={{ marginTop: 12 }}><button className="primary" onClick={() => setLastResult(null)}>إغلاق</button></div>
          </div>
        )}

        {/* شاشة أداء الامتحان للطالب */}
        {activeExam ? (
          <section className="take-exam-box">
            <div className="section-heading" style={{ marginBottom: 20 }}>
              <div><h2>{activeExam.subject} — {activeExam.grade}</h2><p>أجب عن جميع الأسئلة قبل انتهاء الوقت.</p></div>
              <div className="exam-timer"><Clock3 size={18}/> الوقت المتبقي: {formatTime(timeLeft)}</div>
            </div>

            {(activeExam.questions || []).map((q, idx) => (
              <div className="q-card" key={q.id}>
                <h4>{idx + 1}. {q.text} <span className="muted" style={{ fontSize: 12 }}>({q.points} درجة)</span></h4>
                {q.type === 'mcq' && q.options ? (
                  <div>
                    {q.options.map((opt, optIdx) => (
                      <label key={optIdx} className={studentAnswers[q.id] === optIdx ? 'opt-label selected' : 'opt-label'}>
                        <input
                          type="radio"
                          name={q.id}
                          checked={studentAnswers[q.id] === optIdx}
                          onChange={() => setStudentAnswers(prev => ({ ...prev, [q.id]: optIdx }))}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    placeholder="اكتب إجابتك المقالية هنا..."
                    value={(studentAnswers[q.id] as string) || ''}
                    onChange={e => setStudentAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}

            <div className="modal-actions">
              <button className="secondary" onClick={() => setActiveExam(null)}>انسحاب</button>
              <button className="primary" onClick={handleFinishExam} disabled={submittingExam}>
                {submittingExam ? 'جارٍ التصحيح والتسليم...' : 'تسليم الإجابات'}
              </button>
            </div>
          </section>
        ) : (
          <>
            {tab === 'overview' && <>
              <section className="welcome"><div><p className="eyebrow">لوحة التحكم</p><h2>أهلًا بك يا {userProfile?.fullName}</h2><p>منصة متكاملة لإدارة وأداء الامتحانات الإلكترونية والتصحيح الفوري.</p></div><GraduationCap size={76} /></section>
              <section className="stats">
                <article className="stat-card"><span>الامتحانات المتاحة</span><strong>{exams.length}</strong><small>امتحانات مسجلة في النظام</small></article>
                <article className="stat-card"><span>{isStaff ? 'الطلاب المسجلين' : 'امتحانات أديتها'}</span><strong>{isStaff ? studentsList.length : submissions.length}</strong><small>{isStaff ? 'إجمالي حسابات الطلاب' : 'عدد مرات التسليم'}</small></article>
                <article className="stat-card"><span>الصلاحية</span><strong className="role-value">{role === 'admin' ? 'مدير' : role === 'teacher' ? 'مدرس' : 'طالب'}</strong><small>حساب موثق</small></article>
              </section>
              <section className="panel">
                <h3>البدء السريع</h3>
                <p>{isStaff ? 'انتقل إلى قسم "الامتحانات" لإنشاء امتحان جديد ونشره للطلاب.' : 'انتقل إلى قسم "الامتحانات" لبدء الامتحانات المتاحة والحصول على نتيجتك فورًا.'}</p>
              </section>
            </>}

            {tab === 'exams' && <section className="panel">
              <div className="section-heading">
                <div><h2>الامتحانات</h2><p>{isStaff ? 'إدارة الامتحانات ونشرها للطلاب.' : 'اختر الامتحان لبدء الاختبار.'}</p></div>
                {isStaff && <button className="primary action-btn" onClick={() => setShowExamForm(true)}><Plus size={17}/> إنشاء امتحان جديد</button>}
              </div>
              <div className="exam-list">
                {exams.map(exam => {
                  const alreadyTaken = submissions.some(s => s.examId === exam.id)
                  return (
                    <article className="exam-card" key={exam.id}>
                      <div className="exam-icon"><ClipboardList/></div>
                      <div className="exam-info">
                        <b>{exam.title}</b>
                        <span>{exam.subject} · {exam.grade}</span>
                        <small><Clock3 size={13}/> {exam.duration} دقيقة <FileQuestion size={13}/> {exam.questionCount ?? 0} سؤال</small>
                      </div>
                      {isStaff ? (
                        <>
                          <span className={exam.status === 'published' ? 'status published' : 'status draft'}>{exam.status === 'published' ? 'منشور' : 'مسودة'}</span>
                          <button className="text-btn" onClick={() => changeExamStatus(exam)}>{exam.status === 'published' ? 'إلغاء النشر' : 'نشر للطلاب'}</button>
                          <button className="icon-btn" onClick={() => deleteExam(exam.id)} title="حذف"><Trash2 size={16} color="#b91c1c"/></button>
                        </>
                      ) : (
                        <button className="primary action-btn" onClick={() => startExam(exam)}>
                          <Play size={15}/> {alreadyTaken ? 'إعادة الامتحان' : 'ابدأ الامتحان'}
                        </button>
                      )}
                    </article>
                  )
                })}
                {exams.length === 0 && <div className="empty-state">لا توجد امتحانات متاحة حاليًا.</div>}
              </div>
            </section>}

            {tab === 'results' && <section className="panel">
              <h2>{isStaff ? 'سجل نتائج الطلاب' : 'سجل درجاتي'}</h2>
              {submissions.length === 0 ? (
                <div className="empty-state">لا توجد نتائج مسجلة حتى الآن.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {isStaff && <th>اسم الطالب</th>}
                        <th>الامتحان</th>
                        <th>الدرجة</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map(s => (
                        <tr key={s.id}>
                          {isStaff && <td><b>{s.studentName}</b><br/><small className="muted">{s.studentEmail}</small></td>}
                          <td>{s.examTitle}</td>
                          <td><b>{s.score} / {s.totalPoints}</b></td>
                          <td><span className={s.status === 'graded' ? 'status published' : 'status draft'}>{s.status === 'graded' ? 'مُصحح تلقائيًا' : 'بانتظار مراجعة المقالي'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>}

            {tab === 'students' && isStaff && <section className="panel">
              <h2>الطلاب المسجلون ({studentsList.length})</h2>
              {studentsList.length === 0 ? (
                <div className="empty-state">لا يوجد طلاب مسجلون بعد.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الدور</th></tr></thead>
                    <tbody>
                      {studentsList.map(st => (
                        <tr key={st.uid}><td><b>{st.fullName}</b></td><td>{st.email}</td><td>طالب</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>}
          </>
        )}

        <footer>إدارة وإشراف: محمد رمضان الحرباوي</footer>
      </main>

      {showExamForm && <div className="modal-backdrop"><form className="exam-modal" onSubmit={saveExam}>
        <div className="modal-heading"><div><p className="eyebrow">إدارة الامتحانات</p><h2>إنشاء امتحان جديد</h2></div><button type="button" className="icon-btn" onClick={() => setShowExamForm(false)}><X/></button></div>
        <div className="form-grid">
          <label>اسم الامتحان<input value={examTitle} onChange={e => setExamTitle(e.target.value)} required placeholder="مثال: امتحان الوحدة الأولى"/></label>
          <label>المادة<input value={subject} onChange={e => setSubject(e.target.value)} required placeholder="اللغة العربية"/></label>
          <label>الصف الدراسي<input value={grade} onChange={e => setGrade(e.target.value)} required placeholder="الصف الثالث الثانوي"/></label>
          <label>المدة بالدقائق<input type="number" min="1" max="300" value={duration} onChange={e => setDuration(Number(e.target.value))} required/></label>
        </div>
        <div className="question-builder">
          <h3>إضافة سؤال</h3>
          <div className="inline-fields"><label>نوع السؤال<select value={questionType} onChange={e => setQuestionType(e.target.value as 'mcq'|'essay')}><option value="mcq">اختيار من متعدد</option><option value="essay">مقالي</option></select></label><label>الدرجة<input type="number" min="1" value={points} onChange={e => setPoints(Number(e.target.value))}/></label></div>
          <label>نص السؤال<textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={2} placeholder="اكتب السؤال هنا..."/></label>
          {questionType === 'mcq' && <div className="options-grid">{options.map((option, i) => <label key={i}>الاختيار {i+1}<input value={option} onChange={e => setOptions(old => old.map((v, idx) => idx === i ? e.target.value : v))}/></label>)}<label>الإجابة الصحيحة<select value={correctAnswer} onChange={e => setCorrectAnswer(Number(e.target.value))}>{options.map((_, i) => <option key={i} value={i}>الاختيار {i+1}</option>)}</select></label></div>}
          <button type="button" className="secondary" onClick={addQuestion}><Plus size={16}/> إضافة السؤال للقائمة</button>
          <p className="small">الأسئلة المضافة: {questions.length}</p>
          {questions.map((q, i) => (
            <div className="question-chip" key={q.id}>
              <span>{i+1}. {q.type === 'mcq' ? 'اختياري' : 'مقالي'} — {q.text} ({q.points} درجة)</span>
              <button type="button" className="icon-btn" onClick={() => setQuestions(old => old.filter(item => item.id !== q.id))}><X size={14}/></button>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowExamForm(false)}>إلغاء</button><button className="primary" disabled={savingExam}>{savingExam ? 'جارٍ الحفظ...' : 'حفظ الامتحان كمسودة'}</button></div>
      </form></div>}
    </div>
  )
}

function SetupScreen() {
  return (
    <main className="setup-screen">
      <div className="setup-card">
        <div className="brand-mark"><GraduationCap size={30}/></div>
        <p className="eyebrow">منصة تعليمية متكاملة</p>
        <h1>منصة الحرباوي للامتحانات</h1>
        <p className="muted">تم تشغيل الموقع بنجاح! ينقص فقط ربط مفاتيح قاعدة البيانات (Firebase).</p>
        <div className="notice">
          <strong>خطوات التفعيل على Vercel أو جهازك:</strong><br/>
          1. أضف متغيرات البيئة <code>VITE_FIREBASE_API_KEY</code> وباقي القيم في إعدادات Vercel.<br/>
          2. أو ضعها في ملف <code>.env</code> في جذر المشروع ثم أعد التشغيل.
        </div>
      </div>
    </main>
  )
}
