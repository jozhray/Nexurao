import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAYz6VUVDyWnoDNr52C4as_Wrxk-Z_pTm8",
  authDomain: "crispconnect.firebaseapp.com",
  databaseURL: "https://crispconnect-default-rtdb.firebaseio.com",
  projectId: "crispconnect",
  storageBucket: "crispconnect.firebasestorage.app",
  messagingSenderId: "473590056152",
  appId: "1:473590056152:web:539324c60331ca7e2f03ad",
  measurementId: "G-296LP4HLJ9"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);
export default app;
