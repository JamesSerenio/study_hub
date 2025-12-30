import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';

const Home: React.FC = () => {
  return (
    <IonPage className="home-page">
      <IonHeader>
      </IonHeader>

      <IonContent fullscreen className="home-content">
        <IonHeader collapse="condense">
          <IonToolbar className="home-toolbar-condense">
            <IonTitle size="large">Blank</IonTitle>
          </IonToolbar>
        </IonHeader>
      </IonContent>
    </IonPage>
  );
};

export default Home;