import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDRfwjLJyECybqhz6YYQJeBJwYnLwsBjLg",
  authDomain: "money-management-621bd.firebaseapp.com",
  projectId: "money-management-621bd",
  storageBucket: "money-management-621bd.firebasestorage.app",
  messagingSenderId: "289171321225",
  appId: "1:289171321225:web:0d6df3efa17315e970f158",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
