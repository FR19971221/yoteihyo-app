/**
 * Firebase 設定ファイル
 * 
 * Firebase Console (https://console.firebase.google.com/) でプロジェクトを作成後、
 * 「Webアプリを追加」して表示された firebaseConfig の内容を以下に貼り付けてください。
 * 
 * ※ Firebaseが未設定（YOUR_API_KEY のまま）の間は、自動的にローカルストレージ（ブラウザ内保存）で動作します。
 */

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 管理者パスワード（編集権限アンロック用）
// ※ お好みのパスワードに変更してください（デフォルト: admin）
window.ADMIN_PASSWORD = "admin";
