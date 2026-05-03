import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  enableIndexedDbPersistence,
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDniUIQgCMM7nXvXrQri6Je8_GgYx8VdNY",
  authDomain: "opticalapp-fb7d3.firebaseapp.com",
  projectId: "opticalapp-fb7d3",
  storageBucket: "opticalapp-fb7d3.firebasestorage.app",
  messagingSenderId: "950771487863",
  appId: "1:950771487863:web:4e8688cbb427b404f7a272"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((error) => {
  console.warn("Firestore offline persistence unavailable:", error.code);
});
