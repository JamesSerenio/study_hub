import { useState } from "react";
import {
  IonPage,
  IonContent,
  IonInput,
  IonButton,
  IonItem,
  IonLabel,
} from "@ionic/react";

const Login: React.FC = () => {
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  return (
    <IonPage>
      <IonContent fullscreen className="login-content">
        <div className="login-wrapper">
          <div className="login-box">
            <h2>Login</h2>

            {/* EMAIL */}
            <IonItem
              lines="none"
              className={`input-item ${emailFocused ? "item-has-focus" : ""}`}
            >
              <IonLabel position="floating">Email</IonLabel>
              <IonInput
                type="email"
                onIonFocus={() => setEmailFocused(true)}
                onIonBlur={() => setEmailFocused(false)}
              />
            </IonItem>

            {/* PASSWORD */}
            <IonItem
              lines="none"
              className={`input-item ${passwordFocused ? "item-has-focus" : ""}`}
            >
              <IonLabel position="floating">Password</IonLabel>
              <IonInput
                type="password"
                onIonFocus={() => setPasswordFocused(true)}
                onIonBlur={() => setPasswordFocused(false)}
              />
            </IonItem>

            <IonButton expand="block" className="login-btn">
              Login
            </IonButton>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Login;
