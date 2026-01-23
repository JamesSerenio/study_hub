import React, { useEffect, useState } from "react";
import {
  IonPage,
  IonContent,
  IonButton,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonDatetime,
  IonToast,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

interface PackageOption {
  id: string;
  option_name: string;
  duration_value: number;
  duration_unit: "hour" | "day" | "month" | "year";
  price: number;
}

interface Package {
  id: string;
  title: string;
  area: "common_area" | "conference_room";
  amenities: string | null;
  package_options: PackageOption[];
}

const seats = [
  "Table 1",
  "Table 2",
  "Table 3",
  "Table 4",
  "Table 5",
  "Table 6",
];

const Customer_Promo_Booking: React.FC = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [selectedOption, setSelectedOption] = useState<PackageOption | null>(null);

  const [seat, setSeat] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");

  const [toast, setToast] = useState("");

  useEffect(() => {
    loadPackages();
  }, []);

  const loadPackages = async () => {
    const { data } = await supabase
      .from("packages")
      .select(`
        *,
        package_options (*)
      `)
      .eq("is_active", true);

    setPackages(data || []);
  };

  const calculateEndTime = () => {
    if (!selectedOption || !startDate || !startTime) return null;

    const start = new Date(`${startDate}T${startTime}`);
    const end = new Date(start);

    const v = selectedOption.duration_value;

    switch (selectedOption.duration_unit) {
      case "hour":
        end.setHours(end.getHours() + v);
        break;
      case "day":
        end.setDate(end.getDate() + v);
        break;
      case "month":
        end.setMonth(end.getMonth() + v);
        break;
      case "year":
        end.setFullYear(end.getFullYear() + v);
        break;
    }

    return end.toISOString();
  };

  const submitBooking = async () => {
    if (!selectedPkg || !selectedOption) return;

    if (selectedPkg.area === "common_area" && !seat) {
      return setToast("Please select seat");
    }

    if (!startDate || !startTime) {
      return setToast("Please select start date and time");
    }

    const time_started = new Date(`${startDate}T${startTime}`).toISOString();
    const time_ended = calculateEndTime();

    const { error } = await supabase.from("customer_sessions").insert({
      full_name: "Customer",
      customer_type: "promo",
      has_id: false,
      hour_avail: "OPEN",
      seat_number:
        selectedPkg.area === "common_area" ? seat : "CONFERENCE ROOM",
      time_started,
      time_ended,
      total_time: 0,
      total_amount: selectedOption.price,
      reservation: "yes",
      reservation_date: startDate,
    });

    if (error) {
      setToast(error.message);
    } else {
      setToast("Promo booked successfully");
    }
  };

  return (
    <IonPage>
      <IonContent className="ion-padding">

        <h2>Promo Booking</h2>

        {/* PACKAGE */}
        <IonSelect
          placeholder="Select Promo"
          onIonChange={(e) =>
            setSelectedPkg(packages.find(p => p.id === e.detail.value) || null)
          }
        >
          {packages.map(p => (
            <IonSelectOption key={p.id} value={p.id}>
              {p.title}
            </IonSelectOption>
          ))}
        </IonSelect>

        {/* OPTION */}
        {selectedPkg && (
          <IonSelect
            placeholder="Select Package Option"
            onIonChange={(e) =>
              setSelectedOption(
                selectedPkg.package_options.find(o => o.id === e.detail.value) || null
              )
            }
          >
            {selectedPkg.package_options.map(opt => (
              <IonSelectOption key={opt.id} value={opt.id}>
                {opt.option_name} — ₱{opt.price}
              </IonSelectOption>
            ))}
          </IonSelect>
        )}

        {/* SEAT */}
        {selectedPkg?.area === "common_area" && (
          <IonSelect
            placeholder="Select Seat"
            value={seat}
            onIonChange={e => setSeat(e.detail.value)}
          >
            {seats.map(s => (
              <IonSelectOption key={s} value={s}>
                {s}
              </IonSelectOption>
            ))}
          </IonSelect>
        )}

        {/* DATE */}
        <IonItem>
          <IonLabel>Start Date</IonLabel>
          <IonDatetime
            presentation="date"
            onIonChange={e => setStartDate(e.detail.value!.split("T")[0])}
          />
        </IonItem>

        {/* TIME */}
        <IonItem>
          <IonLabel>Start Time</IonLabel>
          <IonDatetime
            presentation="time"
            onIonChange={e => setStartTime(e.detail.value!.split("T")[1].slice(0, 5))}
          />
        </IonItem>

        <IonButton expand="block" onClick={submitBooking}>
          Confirm Booking
        </IonButton>

        <IonToast
          isOpen={!!toast}
          message={toast}
          duration={2500}
          onDidDismiss={() => setToast("")}
        />
      </IonContent>
    </IonPage>
  );
};

export default Customer_Promo_Booking;
