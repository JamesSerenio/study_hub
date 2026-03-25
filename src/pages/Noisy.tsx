import React, { useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

type ReportType =
  | "concern"
  | "feedback"
  | "suggestion"
  | "complaint"
  | "request"
  | "other";

const pageBg = "linear-gradient(180deg, #6f775d 0%, #5f6850 100%)";
const cardBg = "#f4ead9";
const inputBg = "#e9dfcf";
const darkBtn = "#1f2329";
const greenBtn = "#4f9b87";

const Noisy: React.FC = () => {
  const [name, setName] = useState<string>("");
  const [seatNumber, setSeatNumber] = useState<string>("");
  const [reportType, setReportType] = useState<ReportType>("concern");
  const [message, setMessage] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  const titleText = useMemo(() => {
    switch (reportType) {
      case "feedback":
        return "Share Your Feedback";
      case "suggestion":
        return "Send a Suggestion";
      case "complaint":
        return "Submit a Complaint";
      case "request":
        return "Send a Request";
      case "other":
        return "Write a Message";
      default:
        return "Add Concern";
    }
  }, [reportType]);

  const resetForm = (): void => {
    setName("");
    setSeatNumber("");
    setReportType("concern");
    setMessage("");
    setSubmitted(false);
  };

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedSeat = seatNumber.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName || !trimmedSeat || !trimmedMessage) {
      alert("Please fill in Name, Seat, and Message.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        name: trimmedName,
        seat_number: trimmedSeat,
        report_type: reportType,
        message: trimmedMessage,
        concern: trimmedMessage,
        status: "pending",
        is_read: false,
      };

      const { error } = await supabase.from("noisy_reports").insert([payload]);

      if (error) {
        alert(`Failed to save: ${error.message}`);
        return;
      }

      setSubmitted(true);
      setName("");
      setSeatNumber("");
      setReportType("concern");
      setMessage("");
    } catch (err) {
      console.error("Unexpected insert error:", err);
      alert("Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <style>
          {`
            .noisy-page {
              min-height: 100vh;
              background: ${pageBg};
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 18px;
              font-family: Arial, sans-serif;
            }

            .noisy-shell {
              width: 100%;
              max-width: 560px;
              animation: fadeSlideUp 0.55s ease;
            }

            .noisy-card {
              background: ${cardBg};
              border-radius: 30px;
              padding: 28px 20px 22px;
              box-shadow: 0 18px 45px rgba(0, 0, 0, 0.16);
              position: relative;
              overflow: hidden;
            }

            .noisy-card::before {
              content: "";
              position: absolute;
              top: -80px;
              right: -80px;
              width: 180px;
              height: 180px;
              background: rgba(79, 155, 135, 0.16);
              border-radius: 50%;
              filter: blur(2px);
            }

            .noisy-card::after {
              content: "";
              position: absolute;
              bottom: -70px;
              left: -70px;
              width: 160px;
              height: 160px;
              background: rgba(31, 35, 41, 0.06);
              border-radius: 50%;
            }

            .noisy-content {
              position: relative;
              z-index: 2;
            }

            .noisy-badge {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              background: rgba(79, 155, 135, 0.14);
              color: #2f6f5e;
              padding: 8px 14px;
              border-radius: 999px;
              font-size: 13px;
              font-weight: 700;
              margin-bottom: 14px;
              animation: pulseSoft 2.2s infinite ease-in-out;
            }

            .noisy-title {
              font-size: 30px;
              font-weight: 800;
              color: #111;
              margin: 0 0 10px;
              line-height: 1.1;
            }

            .noisy-subtitle {
              font-size: 15px;
              color: #615747;
              margin: 0 0 22px;
              line-height: 1.5;
            }

            .noisy-label {
              display: block;
              font-size: 15px;
              font-weight: 700;
              margin-bottom: 9px;
              color: #1f1b16;
            }

            .noisy-field {
              margin-bottom: 16px;
            }

            .noisy-input,
            .noisy-select,
            .noisy-textarea {
              width: 100%;
              border: none;
              outline: none;
              background: ${inputBg};
              border-radius: 18px;
              padding: 16px 18px;
              font-size: 16px;
              color: #2c2c2c;
              box-sizing: border-box;
              transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
              appearance: none;
              -webkit-appearance: none;
            }

            .noisy-input:focus,
            .noisy-select:focus,
            .noisy-textarea:focus {
              background: #ece1d0;
              transform: translateY(-1px);
              box-shadow: 0 0 0 3px rgba(79, 155, 135, 0.18);
            }

            .noisy-textarea {
              min-height: 160px;
              resize: vertical;
              font-family: Arial, sans-serif;
            }

            .noisy-row {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 14px;
            }

            .noisy-actions {
              display: flex;
              gap: 12px;
              flex-wrap: wrap;
              margin-top: 6px;
            }

            .noisy-btn {
              border: none;
              border-radius: 18px;
              padding: 14px 24px;
              font-size: 16px;
              font-weight: 700;
              cursor: pointer;
              transition: transform 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease;
              min-width: 130px;
            }

            .noisy-btn:hover {
              transform: translateY(-2px);
            }

            .noisy-btn:active {
              transform: translateY(0);
            }

            .noisy-btn:disabled {
              opacity: 0.7;
              cursor: not-allowed;
            }

            .noisy-btn-primary {
              background: ${darkBtn};
              color: #fff;
              box-shadow: 0 10px 18px rgba(31, 35, 41, 0.18);
            }

            .noisy-btn-secondary {
              background: ${greenBtn};
              color: #fff;
              box-shadow: 0 10px 18px rgba(79, 155, 135, 0.2);
            }

            .noisy-success {
              margin-top: 18px;
              padding: 14px 16px;
              border-radius: 16px;
              background: rgba(79, 155, 135, 0.14);
              color: #2a6656;
              font-size: 14px;
              font-weight: 700;
              animation: popIn 0.28s ease;
            }

            @keyframes fadeSlideUp {
              from {
                opacity: 0;
                transform: translateY(24px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            @keyframes popIn {
              from {
                opacity: 0;
                transform: scale(0.96);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }

            @keyframes pulseSoft {
              0% {
                transform: scale(1);
              }
              50% {
                transform: scale(1.02);
              }
              100% {
                transform: scale(1);
              }
            }

            @media (max-width: 640px) {
              .noisy-page {
                padding: 14px;
                align-items: flex-start;
              }

              .noisy-shell {
                max-width: 100%;
              }

              .noisy-card {
                border-radius: 24px;
                padding: 22px 16px 18px;
                margin-top: 14px;
              }

              .noisy-title {
                font-size: 26px;
              }

              .noisy-subtitle {
                font-size: 14px;
              }

              .noisy-row {
                grid-template-columns: 1fr;
                gap: 0;
              }

              .noisy-input,
              .noisy-select,
              .noisy-textarea {
                font-size: 16px;
              }

              .noisy-actions {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
              }

              .noisy-btn {
                width: 100%;
                min-width: 0;
                padding: 14px 14px;
                font-size: 15px;
              }
            }
          `}
        </style>

        <div className="noisy-page">
          <div className="noisy-shell">
            <div className="noisy-card">
              <div className="noisy-content">
                <div className="noisy-badge">Guest Message Form</div>

                <h1 className="noisy-title">{titleText}</h1>
                <p className="noisy-subtitle">
                  You can send a concern, feedback, suggestion, complaint, request,
                  or any other message here.
                </p>

                <form onSubmit={(e) => void handleSubmit(e)}>
                  <div className="noisy-row">
                    <div className="noisy-field">
                      <label className="noisy-label">Name</label>
                      <input
                        className="noisy-input"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter your name"
                      />
                    </div>

                    <div className="noisy-field">
                      <label className="noisy-label">Seat</label>
                      <input
                        className="noisy-input"
                        type="text"
                        value={seatNumber}
                        onChange={(e) => setSeatNumber(e.target.value)}
                        placeholder="Enter seat number"
                      />
                    </div>
                  </div>

                  <div className="noisy-field">
                    <label className="noisy-label">Type</label>
                    <select
                      className="noisy-select"
                      value={reportType}
                      onChange={(e) => setReportType(e.target.value as ReportType)}
                    >
                      <option value="concern">Concern</option>
                      <option value="feedback">Feedback</option>
                      <option value="suggestion">Suggestion</option>
                      <option value="complaint">Complaint</option>
                      <option value="request">Request</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="noisy-field">
                    <label className="noisy-label">Message</label>
                    <textarea
                      className="noisy-textarea"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Write your message here..."
                      rows={6}
                    />
                  </div>

                  <div className="noisy-actions">
                    <button
                      type="submit"
                      disabled={saving}
                      className="noisy-btn noisy-btn-primary"
                    >
                      {saving ? "Saving..." : "Submit"}
                    </button>

                    <button
                      type="button"
                      onClick={resetForm}
                      className="noisy-btn noisy-btn-secondary"
                    >
                      Clear
                    </button>
                  </div>

                  {submitted ? (
                    <div className="noisy-success">
                      Your message has been submitted successfully.
                    </div>
                  ) : null}
                </form>
              </div>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Noisy;