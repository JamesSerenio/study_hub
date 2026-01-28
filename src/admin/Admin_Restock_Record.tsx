// src/pages/Admin_Restock_Record.tsx
// ✅ Calendar icon -> opens IonDatetime calendar modal (like your screenshot)
// ✅ Table columns: Image, Item Name, Category, Qty Restocked, Restock Date/Time
// ✅ Date filter by created_at date
// ✅ No "any"
// ✅ Normalize joined add_ons (object OR array)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonInput,
  IonGrid,
  IonRow,
  IonCol,
  IonSpinner,
  IonText,
  IonModal,
  IonButtons,
  IonDatetime,
  IonImg,
} from "@ionic/react";
import {
  refreshOutline,
  calendarOutline,
  closeCircleOutline,
  closeOutline,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

type AddOnJoin = {
  name: string | null;
  category: string | null;
  image_url: string | null;
};

type AddOnJoinRaw = AddOnJoin | AddOnJoin[] | null;

interface RestockRecordRow {
  id: string;
  created_at: string; // timestamptz
  add_on_id: string;
  qty: number;
  add_ons: AddOnJoin | null;
}

type RestockRecordRaw = {
  id: unknown;
  created_at: unknown;
  add_on_id: unknown;
  qty: unknown;
  add_ons?: unknown;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const asStringOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

const asString = (v: unknown): string =>
  typeof v === "string" ? v : "";

const asNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const normalizeAddOns = (v: unknown): AddOnJoin | null => {
  if (!v) return null;

  if (Array.isArray(v)) {
    const first = v[0];
    if (!isRecord(first)) return null;
    return {
      name: asStringOrNull(first.name),
      category: asStringOrNull(first.category),
      image_url: asStringOrNull(first.image_url),
    };
  }

  if (isRecord(v)) {
    return {
      name: asStringOrNull(v.name),
      category: asStringOrNull(v.category),
      image_url: asStringOrNull(v.image_url),
    };
  }

  return null;
};

const normalizeRow = (raw: unknown): RestockRecordRow | null => {
  if (!isRecord(raw)) return null;

  const r = raw as RestockRecordRaw;

  const id = asString(r.id);
  const created_at = asString(r.created_at);
  const add_on_id = asString(r.add_on_id);

  if (!id || !created_at || !add_on_id) return null;

  return {
    id,
    created_at,
    add_on_id,
    qty: asNumber(r.qty),
    add_ons: normalizeAddOns(r.add_ons as AddOnJoinRaw),
  };
};

const toDateKeyFromISO = (iso: string): string => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const todayKey = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// IonDatetime value is ISO (yyyy-mm-dd or yyyy-mm-ddTHH:mm:ssZ). We just convert to YYYY-MM-DD
const dateKeyFromDatetimeValue = (v: string): string => {
  // usually "2026-01-28" or "2026-01-28T00:00:00.000Z"
  const only = v.split("T")[0];
  return only;
};

const Admin_Restock_Record: React.FC = () => {
  const [records, setRecords] = useState<RestockRecordRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [search, setSearch] = useState<string>("");

  // Date filter
  const [selectedDate, setSelectedDate] = useState<string>(""); // YYYY-MM-DD or ""
  const [dateModalOpen, setDateModalOpen] = useState<boolean>(false);

  const fetchRecords = async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("add_on_restocks")
        .select("id, created_at, add_on_id, qty, add_ons(name, category, image_url)")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rawList: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
      const normalized = rawList
        .map((x) => normalizeRow(x))
        .filter((x): x is RestockRecordRow => x !== null);

      setRecords(normalized);
    } catch (err) {
      console.error("Error fetching restock records:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecords();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchRecords().then(() => event.detail.complete());
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return records.filter((r) => {
      // date filter
      if (selectedDate) {
        if (toDateKeyFromISO(r.created_at) !== selectedDate) return false;
      }

      if (!q) return true;

      const name = (r.add_ons?.name ?? "").toLowerCase();
      const category = (r.add_ons?.category ?? "").toLowerCase();

      return name.includes(q) || category.includes(q);
    });
  }, [records, search, selectedDate]);

  const openCalendar = (): void => {
    setDateModalOpen(true);
  };

  const clearDate = (): void => {
    setSelectedDate("");
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Restock Records</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding admin-restock">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {/* Header */}
        <div className="admin-restock__top">
          <div className="admin-restock__titleRow">
            <IonText>
              <h2 className="admin-restock__title">Admin Restock Record</h2>
            </IonText>

            <IonButton fill="clear" onClick={() => void fetchRecords()} className="admin-restock__refreshBtn">
              <IonIcon icon={refreshOutline} slot="start" />
              Refresh
            </IonButton>
          </div>
        </div>

        {/* Filters row: Search + Date (same style idea as sales report) */}
        <div className="admin-restock__filtersRow">
          <IonItem className="admin-restock__filterItem">
            <IonLabel position="stacked">Search (item / category)</IonLabel>
            <IonInput
              value={search}
              placeholder="Type to search…"
              onIonChange={(e) => setSearch((e.detail.value ?? "").toString())}
            />
          </IonItem>

          <div className="admin-restock__dateCard">
            <div className="admin-restock__dateTop">
              <div className="admin-restock__dateLabel">Report Date (YYYY-MM-DD)</div>

              <div className="admin-restock__dateBtns">
                <IonButton className="admin-restock__dateIconBtn" fill="clear" onClick={openCalendar}>
                  <IonIcon icon={calendarOutline} />
                </IonButton>

                <IonButton
                  className="admin-restock__dateIconBtn"
                  fill="clear"
                  disabled={!selectedDate}
                  onClick={clearDate}
                >
                  <IonIcon icon={closeCircleOutline} />
                </IonButton>
              </div>
            </div>

            <div className="admin-restock__dateValueText">
              {selectedDate || todayKey()}
            </div>

            {selectedDate && (
              <div className="admin-restock__dateSub">Filter ON</div>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="admin-restock__loading">
            <IonSpinner name="crescent" />
            <span>Loading records…</span>
          </div>
        ) : (
          <div className="admin-restock__tableWrap">
            <IonGrid className="admin-restock__grid">
              <IonRow className="admin-restock__headRow">
                <IonCol size="2" className="admin-restock__headCell">Image</IonCol>
                <IonCol size="3" className="admin-restock__headCell">Item Name</IonCol>
                <IonCol size="2.5" className="admin-restock__headCell">Category</IonCol>
                <IonCol size="1.5" className="admin-restock__headCell">Qty</IonCol>
                <IonCol size="3" className="admin-restock__headCell">Restock Date</IonCol>
              </IonRow>

              {filtered.length > 0 ? (
                filtered.map((r) => (
                  <IonRow key={r.id} className="admin-restock__row">
                    <IonCol size="2" className="admin-restock__cell">
                      {r.add_ons?.image_url ? (
                        <IonImg
                          src={r.add_ons.image_url}
                          alt={r.add_ons?.name ?? "item"}
                          className="admin-restock__img"
                        />
                      ) : (
                        <div className="admin-restock__imgFallback">No Image</div>
                      )}
                    </IonCol>

                    <IonCol size="3" className="admin-restock__cell">
                      <div className="admin-restock__item">{r.add_ons?.name ?? "Unknown Item"}</div>
                    </IonCol>

                    <IonCol size="2.5" className="admin-restock__cell">
                      {r.add_ons?.category ?? "—"}
                    </IonCol>

                    <IonCol size="1.5" className="admin-restock__cell">
                      <span className="admin-restock__qty">{r.qty}</span>
                    </IonCol>

                    <IonCol size="3" className="admin-restock__cell">
                      <div className="admin-restock__dt">{formatDateTime(r.created_at)}</div>
                    </IonCol>
                  </IonRow>
                ))
              ) : (
                <IonRow className="admin-restock__empty">
                  <IonCol size="12">No restock records found.</IonCol>
                </IonRow>
              )}
            </IonGrid>
          </div>
        )}

        {/* ✅ IonDatetime Calendar Modal (same behavior as your screenshot) */}
        <IonModal isOpen={dateModalOpen} onDidDismiss={() => setDateModalOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Select Date</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDateModalOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding admin-restock__calendarModal">
            <IonDatetime
              presentation="date"
              value={selectedDate || todayKey()}
              onIonChange={(e) => {
                const val = (e.detail.value ?? "").toString();
                if (!val) return;
                setSelectedDate(dateKeyFromDatetimeValue(val));
              }}
            />

            <IonButton
              expand="block"
              className="admin-restock__doneBtn"
              onClick={() => setDateModalOpen(false)}
            >
              Done
            </IonButton>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Restock_Record;
