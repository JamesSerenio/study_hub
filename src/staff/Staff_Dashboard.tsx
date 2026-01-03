import React, { useEffect, useState } from "react";
import {
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

const HOURLY_RATE = 20;

interface Profile {
  id: string;
  email: string;
  role: "admin" | "staff";
}

interface CustomerForm {
  full_name: string;
  customer_type: "reviewer" | "student" | "regular" | "";
  customer_field: string;
  has_id: boolean;
}

const Staff_Dashboard: React.FC = () => {
  const [profile, setProfile] = useState<Profile | null>(null);

  const [form, setForm] = useState<CustomerForm>({
    full_name: "",
    customer_type: "",
    customer_field: "",
    has_id: false,
  });

  // 🔹 AUTO time started (PH time)
  const [timeStarted] = useState<string>(new Date().toISOString());

  // 🔹 STAFF INPUT (HH:MM)
  const [timeAvail, setTimeAvail] = useState<string>("01:00");

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async (): Promise<void> => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    const { data } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("id", auth.user.id)
      .single<Profile>();

    if (!data || data.role !== "staff") {
      alert("Staff only");
      return;
    }

    setProfile(data);
  };

  // 🧮 Convert HH:MM → hours
  const getTotalHours = (): number => {
    const [h, m] = timeAvail.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return Number((h + m / 60).toFixed(2));
  };

  // ⏰ Auto end time
  const getTimeEnded = (): string => {
    const start = new Date(timeStarted);
    const [h, m] = timeAvail.split(":").map(Number);
    start.setHours(start.getHours() + h);
    start.setMinutes(start.getMinutes() + m);
    return start.toISOString();
  };

  const totalHours = getTotalHours();
  const totalAmount = totalHours * HOURLY_RATE;

  const handleSubmit = async (): Promise<void> => {
    if (!profile || totalHours <= 0) {
      alert("Invalid time avail");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    const { error } = await supabase.from("customer_sessions").insert({
      staff_id: auth.user.id,
      date: new Date().toISOString().split("T")[0],

      full_name: form.full_name,
      customer_type: form.customer_type,
      customer_field: form.customer_field,
      has_id: form.has_id,

      hour_avail: timeAvail,
      time_started: timeStarted,
      time_ended: getTimeEnded(),

      total_hours: totalHours,
      total_amount: totalAmount,
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Customer session saved!");
    }
  };

  return (
    <div className="staff-dashboard">
      <h2 className="form-title">Customer Time Form</h2>

      <div className="form-container">
        <IonItem className="form-item">
          <IonLabel position="stacked">Full Name</IonLabel>
          <IonInput
            value={form.full_name}
            onIonChange={(e) =>
              setForm({ ...form, full_name: e.detail.value ?? "" })
            }
          />
        </IonItem>

        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Type</IonLabel>
          <IonSelect
            value={form.customer_type}
            onIonChange={(e) =>
              setForm({ ...form, customer_type: e.detail.value })
            }
          >
            <IonSelectOption value="reviewer">Reviewer</IonSelectOption>
            <IonSelectOption value="student">Student</IonSelectOption>
            <IonSelectOption value="regular">Regular</IonSelectOption>
          </IonSelect>
        </IonItem>

        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Field</IonLabel>
          <IonInput
            value={form.customer_field}
            onIonChange={(e) =>
              setForm({ ...form, customer_field: e.detail.value ?? "" })
            }
          />
        </IonItem>

        {/* ⏱ TIME AVAIL - Changed to text input for HH:MM only, no AM/PM */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Time Avail (HH:MM)</IonLabel>
          <IonInput
            type="text"
            placeholder="HH:MM (e.g., 01:00 for 1 hour, 00:30 for 30 mins)"
            value={timeAvail}
            onIonChange={(e) => {
              const value = e.detail.value ?? "";
              // Basic validation: ensure format is HH:MM
              if (/^\d{2}:\d{2}$/.test(value)) {
                setTimeAvail(value);
              } else if (value === "") {
                setTimeAvail("");
              }
              // If invalid, don't update (or you could show an error)
            }}
          />
        </IonItem>

        <div className="summary-section">
          <p className="summary-text">
            Time Started: {new Date(timeStarted).toLocaleTimeString("en-PH")}
          </p>
          <p className="summary-text">
            Time Ended: {new Date(getTimeEnded()).toLocaleTimeString("en-PH")}
          </p>
          <p className="summary-text">Total Hours: {totalHours}</p>
          <p className="summary-text">Total Amount: ₱{totalAmount}</p>
        </div>

        <IonButton expand="block" className="submit-button" onClick={handleSubmit}>
          Save Record
        </IonButton>
      </div>
    </div>
  );
};

export default Staff_Dashboard;