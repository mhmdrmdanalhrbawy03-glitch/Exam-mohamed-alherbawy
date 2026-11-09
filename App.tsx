import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where
} from "firebase/firestore";
import { auth, db } from "./firebase";

type Question = {
  text: string;
  type: "mcq" | "essay";
  options?: string[];
  answer?: number;
  points: number;
};

type Exam = {
  id: string;
  title: string;
  subject: string;
  duration: number;
  questions: Question[];
  published: boolean;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [exams, setExams] = useState<Exam[]>([]);
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [answers, setAnswers] = useState<Record<number, string | number>>({});
  const [message, setMessage] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState(30);
  const [questionsJSON, setQuestionsJSON] = useState(
    JSON.stringify(
      [
        {
          text: "اكتب السؤال هنا",
          type: "mcq",
          options: ["الاختيار الأول", "الاختيار الثاني", "الاختيار الثالث", "الاختيار الرابع"],
          answer: 0,
          points: 1
        }
      ],
      null,
      2
    )
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        try {
          const profileRef = doc(db, "users", currentUser.uid);
          const profileSnap = await getDoc(profileRef);

          if (profileSnap.exists()) {
            setProfile(profileSnap.data());
          } else {
            const newProfile = {
              name: currentUser.displayName || currentUser.email,
              email: currentUser.email,
              role: "student",
              createdAt: new Date().toISOString()
            };
            await setDoc(profileRef, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          console.error(error);
          setMessage("تعذر تحميل بيانات الحساب. راجع اتصال Firebase وقواعد Firestore.");
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  async function loadExams() {
    try {
      const snapshot = await getDocs(collection(db, "exams"));
      const list = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      })) as Exam[];

      setExams(
        profile?.role === "admin"
          ? list
          : list.filter((exam) => exam.published)
      );
    } catch (error) {
      console.error(error);
      setMessage("لم نتمكن من تحميل الامتحانات. تأكد من إعداد Firestore Rules.");
    }
  }

  useEffect(() => {
    if (user && profile) loadExams();
  }, [user, profile]);

  async function handleAuth() {
    setMessage("");

    if (!email.trim() || !password) {
      setMessage("اكتب البريد الإلكتروني وكلمة المرور أولاً.");
      return;
    }

    try {
      if (registerMode) {
        if (!name.trim()) {
          setMessage("اكتب اسمك.");
          return;
        }

        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

        const newProfile = {
          name: name.trim(),
          email: email.trim(),
          role: "student",
          createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, "users", credential.user.uid), newProfile);
        setProfile(newProfile);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error: any) {
      console.error(error);
      const errors: Record<string, string> = {
        "auth/email-already-in-use": "البريد الإلكتروني مستخدم بالفعل.",
        "auth/invalid-email": "البريد الإلكتروني غير صحيح.",
        "auth/weak-password": "كلمة المرور يجب أن تكون 6 أحرف على الأقل.",
        "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
        "auth/network-request-failed": "تحقق من اتصال الإنترنت."
      };
      setMessage(errors[error.code] || "حدث خطأ أثناء تسجيل الدخول.");
    }
  }

  async function createExam() {
    setMessage("");

    if (!examTitle.trim() || !subject.trim()) {
      setMessage("اكتب اسم الامتحان والمادة.");
      return;
    }

    try {
      const questions = JSON.parse(questionsJSON) as Question[];

      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error("يجب إضافة سؤال واحد على الأقل.");
      }

      for (const question of questions) {
        if (!question.text || !["mcq", "essay"].includes(question.type)) {
          throw new Error("راجع نصوص الأسئلة وأنواعها.");
        }
        if (question.type === "mcq" &&
          (!question.options || question.options.length < 2)) {
          throw new Error("كل سؤال اختيار من متعدد يحتاج اختيارين على الأقل.");
        }
      }

      await addDoc(collection(db, "exams"), {
        title: examTitle.trim(),
        subject: subject.trim(),
        duration: Math.max(1, Number(duration)),
        questions,
        published: false,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid
      });

      setExamTitle("");
      setSubject("");
      setMessage("تم إنشاء الامتحان بنجاح.");
      await loadExams();
    } catch (error: any) {
      setMessage(
        error instanceof SyntaxError
          ? "صيغة الأسئلة غير صحيحة. راجع JSON."
          : error.message || "تعذر إنشاء الامتحان."
      );
    }
  }

  async function togglePublish(exam: Exam) {
    try {
      const { updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "exams", exam.id), {
        published: !exam.published
      });
      await loadExams();
    } catch (error) {
      console.error(error);
      setMessage("تعذر تغيير حالة نشر الامتحان.");
    }
  }

  async function submitExam() {
    if (!activeExam || !user) return;

    const unanswered = activeExam.questions.some(
      (_, index) => answers[index] === undefined || answers[index] === ""
    );

    if (unanswered && !window.confirm("هناك أسئلة لم تتم الإجابة عنها. هل تريد التسليم؟")) {
      return;
    }

    let score = 0;
    let total = 0;

    activeExam.questions.forEach((question, index) => {
      total += Number(question.points || 1);
      if (
        question.type === "mcq" &&
        Number(answers[index]) === Number(question.answer)
      ) {
        score += Number(question.points || 1);
      }
    });

    try {
      await addDoc(collection(db, "results"), {
        examId: activeExam.id,
        examTitle: activeExam.title,
        studentId: user.uid,
        studentEmail: user.email,
        answers,
        score,
        total,
        submittedAt: new Date().toISOString()
      });

      setActiveExam(null);
      setAnswers({});
      setMessage(`تم تسليم الامتحان بنجاح. درجتك في الاختيار من متعدد: ${score} من ${total}. الأسئلة المقالية تحتاج تصحيح المدرس.`);
    } catch (error) {
      console.error(error);
      setMessage("حدث خطأ أثناء تسليم الامتحان.");
    }
  }

  if (loading) {
    return <div className="loading">جاري تحميل منصة الحرباوي...</div>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark">H</div>
          <h1>منصة الحرباوي</h1>
          <p>منصتك الذكية للامتحانات والتقييم الإلكتروني</p>

          {registerMode && (
            <input
              placeholder="الاسم بالكامل"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}

          <input
            type="email"
            placeholder="البريد الإلكتروني"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="كلمة المرور"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="primary-btn" onClick={handleAuth}>
            {registerMode ? "إنشاء حساب جديد" : "تسجيل الدخول"}
          </button>

          <button
            className="text-btn"
            onClick={() => {
              setRegisterMode(!registerMode);
              setMessage("");
            }}
          >
            {registerMode ? "لديك حساب؟ سجل الدخول" : "ليس لديك حساب؟ أنشئ حساباً"}
          </button>

          {message && <div className="message">{message}</div>}
          <small>إدارة وإشراف: محمد رمضان الحرباوي</small>
        </section>
      </main>
    );
  }

  if (activeExam) {
    return (
      <main className="page">
        <header className="topbar">
          <h2>{activeExam.title}</h2>
          <button className="danger-btn" onClick={() => setActiveExam(null)}>
            خروج
          </button>
        </header>

        <section className="content">
          <div className="exam-info">
            مادة: {activeExam.subject} — المدة: {activeExam.duration} دقيقة
          </div>

          {activeExam.questions.map((question, index) => (
            <article className="question-card" key={index}>
              <h3>
                السؤال {index + 1}: {question.text}
              </h3>
              <p className="muted">الدرجة: {question.points || 1}</p>

              {question.type === "mcq" ? (
                <div className="options">
                  {(question.options || []).map((option, optionIndex) => (
                    <label className="option" key={optionIndex}>
                      <input
                        type="radio"
                        name={`question-${index}`}
                        checked={Number(answers[index]) === optionIndex}
                        onChange={() =>
                          setAnswers({ ...answers, [index]: optionIndex })
                        }
                      />
                      {option}
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  rows={5}
                  placeholder="اكتب إجابتك هنا..."
                  value={String(answers[index] ?? "")}
                  onChange={(e) =>
                    setAnswers({ ...answers, [index]: e.target.value })
                  }
                />
              )}
            </article>
          ))}

          <button className="primary-btn submit-btn" onClick={submitExam}>
            تسليم الامتحان
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h2>منصة الحرباوي</h2>
          <span>أهلاً، {profile?.name || user.email}</span>
        </div>
        <button className="danger-btn" onClick={() => signOut(auth)}>
          تسجيل الخروج
        </button>
      </header>

      <section className="hero">
        <span className="eyebrow">منصة تعليمية إلكترونية</span>
        <h1>ابدأ رحلتك نحو التفوق</h1>
        <p>امتحانات منظمة، تقييم واضح، ومتابعة مستمرة لمستواك.</p>
      </section>

      <section className="content">
        {message && <div className="message">{message}</div>}

        {profile?.role === "admin" && (
          <section className="admin-card">
            <h2>لوحة تحكم الإدارة</h2>
            <p className="muted">إنشاء امتحان جديد</p>

            <input
              placeholder="اسم الامتحان"
              value={examTitle}
              onChange={(e) => setExamTitle(e.target.value)}
            />
            <input
              placeholder="المادة الدراسية"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <input
              type="number"
              min="1"
              placeholder="مدة الامتحان بالدقائق"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />

            <label className="field-label">الأسئلة بصيغة JSON</label>
            <textarea
              className="json-editor"
              rows={13}
              value={questionsJSON}
              onChange={(e) => setQuestionsJSON(e.target.value)}
              dir="ltr"
            />

            <button className="primary-btn" onClick={createExam}>
              إنشاء الامتحان
            </button>
          </section>
        )}

        <div className="section-heading">
          <h2>الامتحانات المتاحة</h2>
          <span>{exams.length} امتحان</span>
        </div>

        {exams.length === 0 ? (
          <div className="empty-state">لا توجد امتحانات متاحة حالياً.</div>
        ) : (
          <div className="exam-grid">
            {exams.map((exam) => (
              <article className="exam-card" key={exam.id}>
                <div className="exam-icon">📝</div>
                <h3>{exam.title}</h3>
                <p>{exam.subject}</p>
                <div className="exam-meta">
                  <span>{exam.questions?.length || 0} سؤال</span>
                  <span>{exam.duration} دقيقة</span>
                </div>

                {profile?.role === "admin" ? (
                  <button
                    className={exam.published ? "danger-btn" : "primary-btn"}
                    onClick={() => togglePublish(exam)}
                  >
                    {exam.published ? "إلغاء النشر" : "نشر الامتحان"}
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    onClick={() => {
                      setAnswers({});
                      setActiveExam(exam);
                    }}
                  >
                    ابدأ الامتحان
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <footer>
        جميع الحقوق محفوظة © منصة الحرباوي للامتحانات
        <br />
        إدارة وإشراف: محمد رمضان الحرباوي
      </footer>
    </main>
  );
}
