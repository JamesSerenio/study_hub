// src/pages/Book_Add.tsx
import React, { useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonButton,
  IonModal,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonIcon,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { useHistory } from "react-router-dom";

import BookingModal from "../components/BookingModal";
import AddOnsModal from "../components/AddOnsModal";

import leaves from "../assets/leave.png";
import studyHubLogo from "../assets/study_hub.png";

type SeatGroup = { title: string; seats: string[] };

const SEAT_GROUPS: SeatGroup[] = [
  {
    title: "1stF",
    seats: ["1", "2", "3", "4", "5", "6", "7a", "7b", "8a", "8b", "9", "10", "11"],
  },
  { title: "TATAMI AREA", seats: ["12a", "12b", "12c"] },
  {
    title: "2ndF",
    seats: ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"],
  },
];

const Book_Add: React.FC = () => {
  const history = useHistory();

  // MAIN MODALS
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [isAddOnsOpen, setIsAddOnsOpen] = useState(false);

  // THANK YOU MODALS
  const [bookingThanksOpen, setBookingThanksOpen] = useState(false);
  const [addOnsThanksOpen, setAddOnsThanksOpen] = useState(false);

  return (
    <IonPage className="bookadd-page">
      <IonHeader />

      <IonContent fullscreen className="bookadd-content" scrollY={false}>
        <img src={leaves} className="leaf leaf-top-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-top-right" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-right" alt="leaf" />

        <div className="bookadd-wrapper">
          <div className="bookadd-hero-card">
            {/* HEADER */}
            <div className="bookadd-hero-header">
              <div className="bookadd-hero-brand">
                <img
                  src={studyHubLogo}
                  className="bookadd-hero-logo"
                  alt="Study Hub"
                  role="button"
                  tabIndex={0}
                  onClick={() => history.push("/login")}
                  onKeyDown={(e) => e.key === "Enter" && history.push("/login")}
                />
                <div className="bookadd-hero-text">
                  <p className="bookadd-hero-title">Welcome to Me Tyme Lounge!</p>
                  <p className="bookadd-hero-subtitle">Rest, relax, and focus in a peaceful environment.</p>
                </div>
              </div>

              <div className="bookadd-hero-chip">
                <span className="bookadd-hero-chip-dot" />
                <span className="bookadd-hero-chip-text">Ready for booking</span>
              </div>
            </div>

            {/* TOPBAR */}
            <div className="bookadd-topbar">
              <p className="bookadd-topbar-title">Choose Action</p>
              <p className="bookadd-topbar-subtitle">Book your seat or order add-ons separately.</p>
            </div>

            {/* ACTION BUTTONS */}
            <div className="bookadd-actions">
              <div className="bookadd-btn-card bookadd-btn-booking">
                <span className="bookadd-btn-label">Booking</span>
                <p className="bookadd-btn-desc">Choose your seat and booking time.</p>
                <IonButton expand="block" onClick={() => setIsBookingOpen(true)}>
                  Booking
                </IonButton>
              </div>

              <div className="bookadd-btn-card bookadd-btn-addons">
                <span className="bookadd-btn-label">Add-Ons</span>
                <p className="bookadd-btn-desc">Enter seat + name then choose add-ons.</p>
                <IonButton expand="block" onClick={() => setIsAddOnsOpen(true)}>
                  Add-Ons
                </IonButton>
              </div>
            </div>
          </div>
        </div>

        {/* MODALS (separate files) */}
        <BookingModal
          isOpen={isBookingOpen}
          onClose={() => setIsBookingOpen(false)}
          onSaved={() => setBookingThanksOpen(true)}
          seatGroups={SEAT_GROUPS}
        />

        <AddOnsModal
          isOpen={isAddOnsOpen}
          onClose={() => setIsAddOnsOpen(false)}
          onSaved={() => setAddOnsThanksOpen(true)}
          seatGroups={SEAT_GROUPS}
        />

        {/* THANK YOU MODAL: BOOKING */}
        <IonModal
          isOpen={bookingThanksOpen}
          onDidDismiss={() => setBookingThanksOpen(false)}
          className="bookadd-thanks-modal"
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Thank you!</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setBookingThanksOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="bookadd-card">
              <p className="summary-text" style={{ fontWeight: 800, marginBottom: 8 }}>
                Thanks for booking.
              </p>
              <p className="summary-text" style={{ opacity: 0.85 }}>
                Please wait a moment. Staff will review your booking details.
              </p>
              <IonButton expand="block" onClick={() => setBookingThanksOpen(false)}>
                OK
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        {/* THANK YOU MODAL: ADD-ONS */}
        <IonModal
          isOpen={addOnsThanksOpen}
          onDidDismiss={() => setAddOnsThanksOpen(false)}
          className="bookadd-thanks-modal"
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Thank you!</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setAddOnsThanksOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="bookadd-card">
              <p className="summary-text" style={{ fontWeight: 800, marginBottom: 8 }}>
                Thank you for your order.
              </p>
              <p className="summary-text" style={{ opacity: 0.85 }}>
                Please wait a few minutes. Staff will confirm and deliver your add-ons.
              </p>
              <IonButton expand="block" onClick={() => setAddOnsThanksOpen(false)}>
                OK
              </IonButton>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Book_Add;
