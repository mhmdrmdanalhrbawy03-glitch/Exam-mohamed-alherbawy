import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCtvLi1JtJ-KjN6cjPzfc56jVb4StxWbM",
  authDomain: "exam-mohamed-alherbawy.firebaseapp.com",
  projectId: "exam-mohamed-alherbawy",
  storageBucket: "exam-mohamed-alherbawy.firebasestorage.app",
  messagingSenderId: "798880376514",
  appId: "1:798880376514:web:487a1d5f87d42e27a0fd5b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
