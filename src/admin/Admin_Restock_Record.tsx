// src/pages/Admin_Restock_Record.tsx
// ✅ Day/Month filter via IonDatetime modal (same calendar style)
// ✅ Export CSV (Excel) based on selected Day/Month
// ✅ Delete by filter (Day/Month): reverses add_ons.restocked then deletes restock rows
// ✅ Edit RESTOCK (exact value): updates restock qty + adjusts add_ons.restocked by delta
// ✅ Void row: reverses add_ons.restocked then deletes row
// ✅ Table shows: image, item, category, restock, restock date, actions
// ✅ No "any" + safe parsing + normalize join (object or array)

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
  IonAlert,
  IonToast,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import {
  refreshOutline,
  calendarOutline,
  closeCircleOutline,
  closeOutline,
  downloadOutline,
  trashOutline,
  createOutline,
  closeCircleOutline as voidIcon,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

type FilterMode = "day" | "month";

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
  qty: number; // restock qty for this record row
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

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const asNumber = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const clampInt = (raw: string, fallback = 0): number => {
  const t = raw.trim();
  if (!t) return fallback;
  const n = Math.floor(Number(t));
  return Number.isFinite(n) ? n : fallback;
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

const todayKey = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const monthKeyNow = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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

const dateKeyFromISO = (iso: string): string => iso.split("T")[0] || "";

const monthKeyFromISO = (iso: string): string => {
  const d = dateKeyFromISO(iso);
  return d.slice(0, 7);
};

const normalizeMonthValue = (v: string): string => {
  const base = v.split("T")[0];
  if (base.length >= 7) return base.slice(0, 7);
  return base;
};

const buildCSV = (rows: RestockRecordRow[]): string => {
  const header = ["Restock Date", "Item Name", "Category", "Restock"];
  const lines = [header.join(",")];

  for (const r of rows) {
    const d = dateKeyFromISO(r.created_at);
    const name = (r.add_ons?.name ?? "Unknown").replaceAll('"', '""');
    const cat = (r.add_ons?.category ?? "—").replaceAll('"', '""');
    const qty = String(r.qty);

    lines.push([`="${d}"`, `"${name}"`, `"${cat}"`, qty].join(","));
  }

  return "\uFEFF" + lines.join("\n");
};

const downloadCSV = (filename: string, csv: string): void => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
};

const Admin_Restock_Record: React.FC = () => {
  const [records, setRecords] = useState<RestockRecordRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  const [search, setSearch] = useState<string>("");

  const [filterMode, setFilterMode] = useState<FilterMode>("day");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const [dateModalOpen, setDateModalOpen] = useState<boolean>(false);
  const [showDeleteFilterAlert, setShowDeleteFilterAlert] = useState(false);

  // ✅ EDIT EXACT VALUE
  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RestockRecordRow | null>(null);
  const [editQty, setEditQty] = useState<string>("0"); // new exact restock value

  const [voidRow, setVoidRow] = useState<RestockRecordRow | null>(null);

  const notify = (msg: string): void => {
    setToastMsg(msg);
    setToastOpen(true);
  };

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
      notify("Failed to load restock records.");
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

  const activeDateLabel = useMemo(() => {
    if (filterMode === "day") return selectedDate || todayKey();
    return selectedMonth || monthKeyNow();
  }, [filterMode, selectedDate, selectedMonth]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return records.filter((r) => {
      if (filterMode === "day") {
        if (selectedDate && dateKeyFromISO(r.created_at) !== selectedDate) return false;
      } else {
        if (selectedMonth && monthKeyFromISO(r.created_at) !== selectedMonth) return false;
      }

      if (!q) return true;

      const name = (r.add_ons?.name ?? "").toLowerCase();
      const category = (r.add_ons?.category ?? "").toLowerCase();
      return name.includes(q) || category.includes(q);
    });
  }, [records, search, filterMode, selectedDate, selectedMonth]);

  const openCalendar = (): void => setDateModalOpen(true);

  const clearFilterValue = (): void => {
    if (filterMode === "day") setSelectedDate("");
    else setSelectedMonth("");
  };

  const exportCSV = (): void => {
    const csv = buildCSV(filtered);
    const suffix = filterMode === "day" ? (selectedDate || todayKey()) : (selectedMonth || monthKeyNow());
    downloadCSV(`restock_records_${suffix}.csv`, csv);
  };

  /* ==========================
     DB HELPERS
  =========================== */

  const adjustRestocked = async (addOnId: string, delta: number): Promise<void> => {
    if (!Number.isFinite(delta) || delta === 0) return;

    const { data: currentRow, error: readErr } = await supabase
      .from("add_ons")
      .select("restocked")
      .eq("id", addOnId)
      .single();

    if (readErr) throw readErr;

    const currentRestocked = asNumber((currentRow as Record<string, unknown>)["restocked"]);
    const next = currentRestocked + delta;
    const safeNext = next < 0 ? 0 : next;

    const { error: upErr } = await supabase
      .from("add_ons")
      .update({ restocked: safeNext })
      .eq("id", addOnId);

    if (upErr) throw upErr;
  };

  const doVoidRow = async (row: RestockRecordRow): Promise<void> => {
    try {
      await adjustRestocked(row.add_on_id, -row.qty);

      const { error: delErr } = await supabase
        .from("add_on_restocks")
        .delete()
        .eq("id", row.id);

      if (delErr) throw delErr;

      setRecords((prev) => prev.filter((x) => x.id !== row.id));
      notify("Voided. Restock and stocks reverted.");
    } catch (e) {
      console.error(e);
      notify("Failed to void record.");
    }
  };

  // ✅ OPEN EDIT (exact value)
  const openEdit = (row: RestockRecordRow): void => {
    setEditingRow(row);
    setEditQty(String(row.qty)); // show current qty as editable
    setEditOpen(true);
  };

  // ✅ SAVE EDIT (exact value) with delta adjustment
  const saveEditQty = async (): Promise<void> => {
    if (!editingRow) return;

    const newQty = clampInt(editQty, 0);
    if (newQty <= 0) {
      notify("Restock must be at least 1.");
      return;
    }

    const oldQty = editingRow.qty;
    const delta = newQty - oldQty; // ✅ only affects THIS row difference

    try {
      // 1) adjust add_ons.restocked by delta
      await adjustRestocked(editingRow.add_on_id, delta);

      // 2) update this restock record qty
      const { data: upData, error: upErr } = await supabase
        .from("add_on_restocks")
        .update({ qty: newQty })
        .eq("id", editingRow.id)
        .select("id")
        .maybeSingle();

      if (upErr) throw upErr;
      if (!upData) {
        notify("Update blocked (check RLS policy for add_on_restocks).");
        return;
      }

      // 3) update UI instantly
      setRecords((prev) => prev.map((x) => (x.id === editingRow.id ? { ...x, qty: newQty } : x)));

      notify("Restock edited.");
      setEditOpen(false);
      setEditingRow(null);

      void fetchRecords();
    } catch (e) {
      console.error(e);
      notify("Failed to edit restock.");
    }
  };

  const deleteByFilter = async (): Promise<void> => {
    const rowsToDelete = filtered;

    if (rowsToDelete.length === 0) {
      notify("No records to delete for the selected filter.");
      setShowDeleteFilterAlert(false);
      return;
    }

    try {
      for (const r of rowsToDelete) {
        await adjustRestocked(r.add_on_id, -r.qty);
      }

      const ids = rowsToDelete.map((r) => r.id);
      const { error: delErr } = await supabase
        .from("add_on_restocks")
        .delete()
        .in("id", ids);

      if (delErr) throw delErr;

      setRecords((prev) => prev.filter((x) => !ids.includes(x.id)));
      notify("Deleted records and reverted restock/stocks.");
    } catch (e) {
      console.error(e);
      notify("Failed to delete by filter.");
    } finally {
      setShowDeleteFilterAlert(false);
    }
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

        {/* TOP */}
        <div className="admin-restock__top">
          <div className="admin-restock__titleRow">
            <IonText>
              <h2 className="admin-restock__title">Admin Restock Record</h2>
            </IonText>

            <div className="admin-restock__topBtns">
              <IonButton fill="outline" onClick={exportCSV}>
                <IonIcon icon={downloadOutline} slot="start" />
                Export Excel
              </IonButton>

              <IonButton color="danger" fill="outline" onClick={() => setShowDeleteFilterAlert(true)}>
                <IonIcon icon={trashOutline} slot="start" />
                Delete By {filterMode === "day" ? "Date" : "Month"}
              </IonButton>

              <IonButton fill="clear" onClick={() => void fetchRecords()}>
                <IonIcon icon={refreshOutline} slot="start" />
                Refresh
              </IonButton>
            </div>
          </div>
        </div>

        {/* FILTERS */}
        <div className="admin-restock__filtersRow">
          <IonItem className="admin-restock__filterItem">
            <IonLabel position="stacked">Search (item / category)</IonLabel>
            <IonInput
              value={search}
              placeholder="Type to search…"
              onIonChange={(e) => setSearch((e.detail.value ?? "").toString())}
            />
          </IonItem>

          <div className="admin-restock__rightFilters">
            <IonItem className="admin-restock__modeItem">
              <IonLabel>Mode</IonLabel>
              <IonSelect value={filterMode} onIonChange={(e) => setFilterMode(String(e.detail.value) as FilterMode)}>
                <IonSelectOption value="day">Day</IonSelectOption>
                <IonSelectOption value="month">Month</IonSelectOption>
              </IonSelect>
            </IonItem>

            <div className="admin-restock__dateCard">
              <div className="admin-restock__dateTop">
                <div className="admin-restock__dateLabel">
                  {filterMode === "day" ? "Report Date (YYYY-MM-DD)" : "Report Month (YYYY-MM)"}
                </div>

                <div className="admin-restock__dateBtns">
                  <IonButton className="admin-restock__dateIconBtn" fill="clear" onClick={openCalendar}>
                    <IonIcon icon={calendarOutline} />
                  </IonButton>

                  <IonButton
                    className="admin-restock__dateIconBtn"
                    fill="clear"
                    disabled={filterMode === "day" ? !selectedDate : !selectedMonth}
                    onClick={clearFilterValue}
                  >
                    <IonIcon icon={closeCircleOutline} />
                  </IonButton>
                </div>
              </div>

              <div className="admin-restock__dateValueText">{activeDateLabel}</div>
              {(filterMode === "day" ? selectedDate : selectedMonth) && (
                <div className="admin-restock__dateSub">Filter ON</div>
              )}
            </div>
          </div>
        </div>

        {/* TABLE */}
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
                <IonCol size="1.5" className="admin-restock__headCell">Restock</IonCol>
                <IonCol size="3" className="admin-restock__headCell">Restock Date</IonCol>
                <IonCol size="2" className="admin-restock__headCell">Actions</IonCol>
              </IonRow>

              {filtered.length > 0 ? (
                filtered.map((r) => (
                  <IonRow key={r.id} className="admin-restock__row">
                    <IonCol size="2" className="admin-restock__cell">
                      {r.add_ons?.image_url ? (
                        <IonImg src={r.add_ons.image_url} alt={r.add_ons?.name ?? "item"} className="admin-restock__img" />
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

                    <IonCol size="2" className="admin-restock__cell">
                      <div className="admin-restock__actionBtns">
                        <IonButton fill="clear" onClick={() => openEdit(r)}>
                          <IonIcon icon={createOutline} />
                        </IonButton>

                        <IonButton fill="clear" color="danger" onClick={() => setVoidRow(r)}>
                          <IonIcon icon={voidIcon} />
                        </IonButton>
                      </div>
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

        {/* CALENDAR MODAL */}
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
            {filterMode === "day" ? (
              <IonDatetime
                presentation="date"
                value={(selectedDate || todayKey()) + "T00:00:00"}
                onIonChange={(e) => {
                  const val = (e.detail.value ?? "").toString();
                  if (!val) return;
                  setSelectedDate(val.split("T")[0]);
                }}
              />
            ) : (
              <IonDatetime
                presentation="month-year"
                value={(selectedMonth || monthKeyNow()) + "-01T00:00:00"}
                onIonChange={(e) => {
                  const val = (e.detail.value ?? "").toString();
                  if (!val) return;
                  setSelectedMonth(normalizeMonthValue(val));
                }}
              />
            )}

            <IonButton expand="block" className="admin-restock__doneBtn" onClick={() => setDateModalOpen(false)}>
              Done
            </IonButton>
          </IonContent>
        </IonModal>

        {/* DELETE BY FILTER CONFIRM */}
        <IonAlert
          isOpen={showDeleteFilterAlert}
          onDidDismiss={() => setShowDeleteFilterAlert(false)}
          header={`Delete by ${filterMode === "day" ? "Date" : "Month"}?`}
          message={
            filterMode === "day"
              ? `This will DELETE all restock records for ${selectedDate || todayKey()} and REVERT stocks. Continue?`
              : `This will DELETE all restock records for ${selectedMonth || monthKeyNow()} and REVERT stocks. Continue?`
          }
          buttons={[
            { text: "Cancel", role: "cancel" },
            { text: "Delete", role: "destructive", handler: () => void deleteByFilter() },
          ]}
        />

        {/* VOID CONFIRM */}
        <IonAlert
          isOpen={!!voidRow}
          onDidDismiss={() => setVoidRow(null)}
          header="VOID this restock?"
          message="This will revert restock/stocks and delete the record."
          buttons={[
            { text: "Cancel", role: "cancel", handler: () => setVoidRow(null) },
            {
              text: "VOID",
              role: "destructive",
              handler: () => {
                if (voidRow) void doVoidRow(voidRow);
                setVoidRow(null);
              },
            },
          ]}
        />

        {/* EDIT MODAL (EXACT EDIT) */}
        <IonModal isOpen={editOpen} onDidDismiss={() => setEditOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Edit Restock</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setEditOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            {editingRow && (
              <>
                <div className="admin-restock__editInfo">
                  <div><b>Item:</b> {editingRow.add_ons?.name ?? "Unknown"}</div>
                  <div><b>Category:</b> {editingRow.add_ons?.category ?? "—"}</div>
                  <div><b>Current Restock:</b> {editingRow.qty}</div>
                  <div><b>Date:</b> {formatDateTime(editingRow.created_at)}</div>
                </div>

                <IonItem>
                  <IonLabel position="stacked">New Restock (Exact Value)</IonLabel>
                  <IonInput
                    type="number"
                    value={editQty}
                    onIonChange={(e) => setEditQty((e.detail.value ?? "").toString())}
                  />
                </IonItem>

                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
                  Change will affect only this row difference (delta).
                </div>

                <div className="admin-restock__editBtns">
                  <IonButton expand="block" onClick={() => void saveEditQty()}>
                    Save
                  </IonButton>
                  <IonButton
                    expand="block"
                    fill="clear"
                    onClick={() => {
                      setEditOpen(false);
                      setEditingRow(null);
                    }}
                  >
                    Cancel
                  </IonButton>
                </div>
              </>
            )}
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={toastOpen}
          message={toastMsg}
          duration={2500}
          onDidDismiss={() => setToastOpen(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Admin_Restock_Record;
