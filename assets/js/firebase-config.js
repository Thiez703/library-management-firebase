import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCnyAyL_ZZigPTkhV_RDIArO6BrKpghmcU",
  authDomain: "library-management-6a7ac.firebaseapp.com",
  projectId: "library-management-6a7ac",
  storageBucket: "library-management-6a7ac.firebasestorage.app",
  messagingSenderId: "977222640738",
  appId: "1:977222640738:web:2d1211f8d7768e05d11d3b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
