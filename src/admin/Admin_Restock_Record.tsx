// src/pages/Admin_Restock_Record.tsx
// ✅ Day/Month filter via IonDatetime modal (same calendar style)
// ✅ Export EXCEL (.xlsx) with nice layout + embedded images (like your add-ons report)
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
  IonSpinner,
  IonModal,
  IonButtons,
  IonDatetime,
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

// ✅ Excel export (same as Add-ons report)
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

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

const ymd = (d: Date): string => {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

// ===== Excel Image Helpers (NO any) =====
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result;
      if (typeof res !== "string") return reject(new Error("Failed to convert image"));
      const base64 = res.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });

const fetchImageBase64 = async (url: string): Promise<{ base64: string; ext: "png" | "jpeg" }> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Image fetch failed");

  const ct = (r.headers.get("content-type") ?? "").toLowerCase();
  const blob = await r.blob();
  const base64 = await blobToBase64(blob);

  const isPng = ct.includes("png") || url.toLowerCase().includes(".png");
  const ext: "png" | "jpeg" = isPng ? "png" : "jpeg";
  return { base64, ext };
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
  const [editQty, setEditQty] = useState<string>("0");

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

  const totalQty = useMemo(() => filtered.reduce((sum, r) => sum + (Number.isFinite(r.qty) ? r.qty : 0), 0), [filtered]);

  const openCalendar = (): void => setDateModalOpen(true);

  const clearFilterValue = (): void => {
    if (filterMode === "day") setSelectedDate("");
    else setSelectedMonth("");
  };

  // ✅ Pretty Excel Export (with images)
  const exportExcel = async (): Promise<void> => {
    try {
      const now = new Date();
      const modeLabel = filterMode === "day" ? "DAY" : "MONTH";
      const filterLabel =
        filterMode === "day" ? (selectedDate || todayKey()) : (selectedMonth || monthKeyNow());
      const title = "RESTOCK RECORDS REPORT";
      const generated = `Generated: ${now.toLocaleString()}`;
      const info = `Mode: ${modeLabel}   Filter: ${filterLabel}   Search: ${search.trim() ? search.trim() : "—"}`;
      const summary = `Total Rows: ${filtered.length}   Total Restock Qty: ${totalQty}`;

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Restocks", {
        views: [{ state: "frozen", ySplit: 6 }],
      });

      // Columns (NO ID column)
      ws.columns = [
        { header: "Image", key: "image", width: 14 },
        { header: "Item Name", key: "name", width: 34 },
        { header: "Category", key: "category", width: 18 },
        { header: "Restock Qty", key: "qty", width: 14 },
        { header: "Restock Date", key: "date", width: 18 },
        { header: "Restock Time", key: "time", width: 14 },
      ];

      // Title rows (1-4)
      ws.mergeCells(1, 1, 1, 6);
      ws.mergeCells(2, 1, 2, 6);
      ws.mergeCells(3, 1, 3, 6);
      ws.mergeCells(4, 1, 4, 6);

      ws.getCell("A1").value = title;
      ws.getCell("A2").value = generated;
      ws.getCell("A3").value = info;
      ws.getCell("A4").value = summary;

      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A3").font = { size: 11 };
      ws.getCell("A4").font = { size: 11, bold: true };

      ws.addRow([]); // row 5 blank

      // Header row = row 6
      const headerRow = ws.getRow(6);
      headerRow.values = ["Image", "Item Name", "Category", "Restock Qty", "Restock Date", "Restock Time"];
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 20;

      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEFEFEF" },
        };
      });

      // Data starts row 7
      let rowIndex = 7;

      for (const r of filtered) {
        const row = ws.getRow(rowIndex);

        const name = r.add_ons?.name ?? "Unknown";
        const cat = r.add_ons?.category ?? "—";

        const d = new Date(r.created_at);
        const datePart = isNaN(d.getTime()) ? dateKeyFromISO(r.created_at) : ymd(d);
        const timePart = isNaN(d.getTime())
          ? ""
          : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

        // A (image) blank -> image overlay
        row.getCell(2).value = name;
        row.getCell(3).value = cat;
        row.getCell(4).value = Number(r.qty ?? 0);
        row.getCell(5).value = datePart;
        row.getCell(6).value = timePart;

        row.height = 52;

        for (let c = 1; c <= 6; c++) {
          const cell = row.getCell(c);
          cell.alignment =
            c === 2 ? { vertical: "middle", horizontal: "left", wrapText: true } : { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        }

        // Image embed (if possible)
        const imgUrl = r.add_ons?.image_url ?? null;
        if (imgUrl) {
          try {
            const { base64, ext } = await fetchImageBase64(imgUrl);
            const imgId = workbook.addImage({ base64, extension: ext });
            ws.addImage(imgId, {
              tl: { col: 0.15, row: rowIndex - 1 + 0.15 },
              ext: { width: 48, height: 48 },
            });
          } catch {
            // leave blank if CORS/fetch fails
          }
        }

        row.commit();
        rowIndex++;
      }

      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(blob, `restock_records_${filterLabel}.xlsx`);
      notify("Exported Excel successfully.");
    } catch (e) {
      console.error(e);
      notify("Export failed.");
    }
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
    setEditQty(String(row.qty));
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
    const delta = newQty - oldQty;

    try {
      await adjustRestocked(editingRow.add_on_id, delta);

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

      setRecords((prev) =>
        prev.map((x) => (x.id === editingRow.id ? { ...x, qty: newQty } : x))
      );

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
      <IonHeader></IonHeader>

      <IonContent className="staff-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="customer-lists-container restock-wrap">
          <div className="customer-topbar restock-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Restock Record</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{activeDateLabel}</strong>{" "}
                <span style={{ marginLeft: 8 }}>
                  (Total: <strong>{filtered.length}</strong> | Qty: <strong>{totalQty}</strong>)
                </span>
              </div>
            </div>

            <div className="customer-topbar-right restock-actions">
              <IonButton className="receipt-btn" fill="outline" onClick={() => void exportExcel()}>
                <IonIcon icon={downloadOutline} slot="start" />
                Export Excel
              </IonButton>

              <IonButton
                className="receipt-btn"
                color="danger"
                fill="outline"
                onClick={() => setShowDeleteFilterAlert(true)}
              >
                <IonIcon icon={trashOutline} slot="start" />
                Delete By {filterMode === "day" ? "Date" : "Month"}
              </IonButton>

              <IonButton className="receipt-btn" fill="outline" onClick={() => void fetchRecords()}>
                <IonIcon icon={refreshOutline} slot="start" />
                Refresh
              </IonButton>
            </div>
          </div>

          <div className="restock-filters">
            <div className="restock-left">
              <div className="restock-search">
                <div className="restock-label">Search (item / category)</div>
                <input
                  className="restock-input"
                  value={search}
                  placeholder="Type to search…"
                  onChange={(e) => setSearch(String(e.currentTarget.value ?? ""))}
                />
              </div>
            </div>

            <div className="restock-right">
              <div className="restock-mode">
                <div className="restock-label">Mode</div>
                <IonItem lines="none" className="restock-ionitem">
                  <IonSelect
                    value={filterMode}
                    interface="popover"
                    onIonChange={(e) => setFilterMode(String(e.detail.value) as FilterMode)}
                  >
                    <IonSelectOption value="day">Day</IonSelectOption>
                    <IonSelectOption value="month">Month</IonSelectOption>
                  </IonSelect>
                </IonItem>
              </div>

              <label className="date-pill restock-datepill">
                <span className="date-pill-label">{filterMode === "day" ? "Date" : "Month"}</span>

                <button type="button" className="restock-datebtn" onClick={openCalendar} title="Open calendar">
                  {activeDateLabel}
                </button>

                <button type="button" className="restock-iconbtn" onClick={openCalendar} title="Calendar">
                  <IonIcon icon={calendarOutline} />
                </button>

                <button
                  type="button"
                  className="restock-iconbtn"
                  disabled={filterMode === "day" ? !selectedDate : !selectedMonth}
                  onClick={clearFilterValue}
                  title="Clear filter"
                >
                  <IonIcon icon={closeCircleOutline} />
                </button>
              </label>
            </div>
          </div>

          {loading ? (
            <div className="customer-note restock-loading">
              <IonSpinner />
              <span>Loading records…</span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="customer-note">No restock records found.</p>
          ) : (
            <div className="customer-table-wrap restock-tablewrap" key={activeDateLabel}>
              <table className="customer-table restock-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Item Name</th>
                    <th>Category</th>
                    <th>Restock</th>
                    <th>Restock Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="restock-row">
                      <td>
                        {r.add_ons?.image_url ? (
                          <img className="restock-img" src={r.add_ons.image_url} alt={r.add_ons?.name ?? "item"} />
                        ) : (
                          <div className="restock-imgFallback">No Image</div>
                        )}
                      </td>

                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{r.add_ons?.name ?? "Unknown Item"}</span>
                        </div>
                      </td>

                      <td>{r.add_ons?.category ?? "—"}</td>

                      <td>
                        <span className="pill pill--dark">{r.qty}</span>
                      </td>

                      <td>{formatDateTime(r.created_at)}</td>

                      <td>
                        <div className="action-stack action-stack--row">
                          <button className="receipt-btn" onClick={() => openEdit(r)} title="Edit">
                            <IonIcon icon={createOutline} />
                            <span style={{ marginLeft: 6 }}>Edit</span>
                          </button>

                          <button className="receipt-btn btn-danger" onClick={() => setVoidRow(r)} title="Void">
                            <IonIcon icon={voidIcon} />
                            <span style={{ marginLeft: 6 }}>Void</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CALENDAR MODAL */}
          <IonModal isOpen={dateModalOpen} onDidDismiss={() => setDateModalOpen(false)}>
            <IonHeader>
              <IonToolbar>
                <IonTitle>{filterMode === "day" ? "Select Date" : "Select Month"}</IonTitle>
                <IonButtons slot="end">
                  <IonButton onClick={() => setDateModalOpen(false)}>
                    <IonIcon icon={closeOutline} />
                  </IonButton>
                </IonButtons>
              </IonToolbar>
            </IonHeader>

            <IonContent className="ion-padding restock-calendar">
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

              <IonButton expand="block" className="restock-done" onClick={() => setDateModalOpen(false)}>
                Done
              </IonButton>
            </IonContent>
          </IonModal>

          {/* DELETE BY FILTER */}
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

          {/* EDIT MODAL */}
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

            <IonContent className="ion-padding restock-edit">
              {editingRow && (
                <>
                  <div className="restock-editInfo">
                    <div>
                      <b>Item:</b> {editingRow.add_ons?.name ?? "Unknown"}
                    </div>
                    <div>
                      <b>Category:</b> {editingRow.add_ons?.category ?? "—"}
                    </div>
                    <div>
                      <b>Current Restock:</b> {editingRow.qty}
                    </div>
                    <div>
                      <b>Date:</b> {formatDateTime(editingRow.created_at)}
                    </div>
                  </div>

                  <IonItem>
                    <IonLabel position="stacked">New Restock (Exact Value)</IonLabel>
                    <IonInput
                      type="number"
                      value={editQty}
                      onIonChange={(e) => setEditQty((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <div className="restock-help">Change will affect only this row difference (delta).</div>

                  <div className="restock-editBtns">
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

          <IonToast isOpen={toastOpen} message={toastMsg} duration={2500} onDidDismiss={() => setToastOpen(false)} />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Restock_Record;
