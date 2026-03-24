import React from "react";
import { IonModal, IonButton, IonIcon } from "@ionic/react";
import { checkmarkCircleOutline, closeOutline } from "ionicons/icons";

export type AddOnAlertMode = "add_ons" | "consignment";

export type AddOnCodeAlertItem = {
  id: string;
  full_name: string;
  seat_number: string;
  booking_code: string;
  order_text: string;
  mode: AddOnAlertMode;
};

interface Props {
  isOpen: boolean;
  alerts: AddOnCodeAlertItem[];
  onCloseOne: (id: string) => void;
  onCloseAll: () => void;
}

const getModeLabel = (mode: AddOnAlertMode): string => {
  return mode === "add_ons" ? "Order" : "Other Items";
};

const AddOnCodeAlertModal: React.FC<Props> = ({
  isOpen,
  alerts,
  onCloseOne,
  onCloseAll,
}) => {
  return (
    <IonModal
      isOpen={isOpen && alerts.length > 0}
      backdropDismiss={false}
      className="addon-code-alert-modal"
    >
      <div className="addon-code-alert-wrapper">
        <style>
          {`
            .addon-code-alert-modal {
              --width: 100%;
              --height: 100%;
              --background: rgba(0,0,0,0.22);
            }

            .addon-code-alert-modal::part(backdrop) {
              background: rgba(0,0,0,0.22);
              opacity: 1;
            }

            .addon-code-alert-modal::part(content) {
              background: transparent;
              box-shadow: none;
            }

            .addon-code-alert-wrapper {
              width: 100%;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 18px;
              box-sizing: border-box;
            }

            .addon-code-alert-stack {
              display: grid;
              gap: 14px;
              width: min(100%, 380px);
            }

            .addon-code-alert-card {
              background: #ffffff;
              border-radius: 22px;
              padding: 18px 16px 16px;
              box-shadow: 0 18px 45px rgba(0,0,0,0.18);
              border: 1px solid rgba(0,0,0,0.05);
            }

            .addon-code-alert-top {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 10px;
            }

            .addon-code-alert-title-wrap {
              display: flex;
              align-items: center;
              gap: 10px;
            }

            .addon-code-alert-icon {
              font-size: 30px;
              color: #39a84b;
              flex-shrink: 0;
            }

            .addon-code-alert-title {
              font-size: 18px;
              font-weight: 900;
              color: #111111;
              line-height: 1.1;
            }

            .addon-code-alert-close {
              --color: #111111;
              margin: 0;
              height: 32px;
              width: 32px;
            }

            .addon-code-alert-body {
              color: #222222;
              font-size: 15px;
              line-height: 1.7;
            }

            .addon-code-alert-row {
              margin-bottom: 2px;
              word-break: break-word;
            }

            .addon-code-alert-row strong {
              font-weight: 800;
              color: #111111;
            }

            .addon-code-alert-btn {
              --background: #39a84b;
              --background-hover: #2f8f3f;
              --background-activated: #2f8f3f;
              --color: #ffffff;
              --border-radius: 14px;
              font-weight: 800;
              height: 46px;
              margin-top: 14px;
              text-transform: none;
            }

            .addon-code-alert-close-all {
              --color: #444444;
              font-weight: 700;
              text-transform: none;
            }

            @media (max-width: 480px) {
              .addon-code-alert-wrapper {
                padding: 14px;
              }

              .addon-code-alert-card {
                border-radius: 20px;
                padding: 16px 14px 14px;
              }

              .addon-code-alert-title {
                font-size: 17px;
              }

              .addon-code-alert-body {
                font-size: 14px;
              }
            }
          `}
        </style>

        <div className="addon-code-alert-stack">
          {alerts.map((a) => (
            <div key={a.id} className="addon-code-alert-card">
              <div className="addon-code-alert-top">
                <div className="addon-code-alert-title-wrap">
                  <IonIcon
                    icon={checkmarkCircleOutline}
                    className="addon-code-alert-icon"
                  />
                  <div className="addon-code-alert-title">Code Verified</div>
                </div>

                <IonButton
                  fill="clear"
                  className="addon-code-alert-close"
                  onClick={() => onCloseOne(a.id)}
                >
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </div>

              <div className="addon-code-alert-body">
                <div className="addon-code-alert-row">
                  <strong>Name:</strong> {a.full_name || "-"}
                </div>
                <div className="addon-code-alert-row">
                  <strong>Seat:</strong> {a.seat_number || "-"}
                </div>
                <div className="addon-code-alert-row">
                  <strong>Type:</strong> {getModeLabel(a.mode)}
                </div>
                <div className="addon-code-alert-row">
                  <strong>Booking Code:</strong> {a.booking_code || "-"}
                </div>
                <div className="addon-code-alert-row">
                  <strong>Order:</strong> {a.order_text || "-"}
                </div>
              </div>

              <IonButton
                expand="block"
                className="addon-code-alert-btn"
                onClick={() => onCloseOne(a.id)}
              >
                OK
              </IonButton>
            </div>
          ))}

          {alerts.length > 1 ? (
            <IonButton
              expand="block"
              fill="clear"
              className="addon-code-alert-close-all"
              onClick={onCloseAll}
            >
              Close All
            </IonButton>
          ) : null}
        </div>
      </div>
    </IonModal>
  );
};

export default AddOnCodeAlertModal;