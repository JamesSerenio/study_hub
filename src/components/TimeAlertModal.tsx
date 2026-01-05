import {
  IonModal,
  IonContent,
  IonButton,
  IonText,
} from "@ionic/react";
import { useEffect, useRef } from "react";

interface Props {
  isOpen: boolean;
  message: string;
  onClose: () => void;
}

const TimeAlertModal: React.FC<Props> = ({
  isOpen,
  message,
  onClose,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isOpen && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => {});
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [isOpen]);

  const stopAlarm = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} backdropDismiss={false}>
      <IonContent className="ion-padding ion-text-center">

        {/* 🔊 ALARM SOUND */}
        <audio ref={audioRef} src="/alarm.mp3" />

        <IonText
          color="danger"
          dangerouslySetInnerHTML={{ __html: message }}
        />

        <IonButton
          expand="block"
          color="success"
          onClick={stopAlarm}
          className="ion-margin-top"
        >
          OK
        </IonButton>
      </IonContent>
    </IonModal>
  );
};

export default TimeAlertModal;
