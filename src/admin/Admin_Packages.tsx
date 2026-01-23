// src/pages/Admin_Packages.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonText,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonList,
  IonListHeader,
  IonSpinner,
  IonModal,
  IonButtons,
  IonIcon,
  IonToast,
  IonGrid,
  IonRow,
  IonCol,
  IonChip,
  IonBadge,
} from "@ionic/react";
import { addOutline, closeOutline, trashOutline, createOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";

interface PackageRow {
  id: string;
  created_at: string;
  admin_id: string;
  area: PackageArea;
  title: string;
  description: string | null;
  amenities: string | null;
  is_active: boolean;
}

interface PackageOptionRow {
  id: string;
  created_at: string;
  package_id: string;
  option_name: string;
  duration_value: number;
  duration_unit: DurationUnit;
  price: number | string; // numeric may come as string
}

const toNum = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const Admin_Packages: React.FC = () => {
  const [loading, setLoading] = useState(true);

  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [optionsByPackage, setOptionsByPackage] = useState<Record<string, PackageOptionRow[]>>({});

  const [openPackageModal, setOpenPackageModal] = useState(false);
  const [openOptionsModal, setOpenOptionsModal] = useState(false);

  const [activePackage, setActivePackage] = useState<PackageRow | null>(null);

  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // package form
  const [pkgArea, setPkgArea] = useState<PackageArea>("common_area");
  const [pkgTitle, setPkgTitle] = useState("");
  const [pkgDesc, setPkgDesc] = useState("");
  const [pkgAmenities, setPkgAmenities] = useState("");
  const [pkgActive, setPkgActive] = useState(true);

  // option form
  const [editingOption, setEditingOption] = useState<PackageOptionRow | null>(null);
  const [optName, setOptName] = useState("");
  const [optDurationValue, setOptDurationValue] = useState<number>(1);
  const [optDurationUnit, setOptDurationUnit] = useState<DurationUnit>("hour");
  const [optPrice, setOptPrice] = useState<number>(0);

  const selectedOptions = useMemo(() => {
    if (!activePackage) return [];
    return optionsByPackage[activePackage.id] || [];
  }, [activePackage, optionsByPackage]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastOpen(true);
  };

  const resetPackageForm = () => {
    setPkgArea("common_area");
    setPkgTitle("");
    setPkgDesc("");
    setPkgAmenities("");
    setPkgActive(true);
  };

  const openCreatePackage = () => {
    setActivePackage(null);
    resetPackageForm();
    setOpenPackageModal(true);
  };

  const openEditPackage = (p: PackageRow) => {
    setActivePackage(p);
    setPkgArea(p.area);
    setPkgTitle(p.title || "");
    setPkgDesc(p.description || "");
    setPkgAmenities(p.amenities || "");
    setPkgActive(!!p.is_active);
    setOpenPackageModal(true);
  };

  const resetOptionForm = () => {
    setEditingOption(null);
    setOptName("");
    setOptDurationValue(1);
    setOptDurationUnit("hour");
    setOptPrice(0);
  };

  const fetchOptionsForPackage = async (packageId: string): Promise<void> => {
    const { data, error } = await supabase
      .from("package_options")
      .select("*")
      .eq("package_id", packageId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      showToast(`Load options failed: ${error.message}`);
      return;
    }

    setOptionsByPackage((prev) => ({
      ...prev,
      [packageId]: (data as PackageOptionRow[]) || [],
    }));
  };

  const openManageOptions = async (p: PackageRow) => {
    setActivePackage(p);
    resetOptionForm();
    setOpenOptionsModal(true);

    if (!optionsByPackage[p.id]) {
      await fetchOptionsForPackage(p.id);
    }
  };

  const openEditOption = (o: PackageOptionRow) => {
    setEditingOption(o);
    setOptName(o.option_name);
    setOptDurationValue(Number(o.duration_value || 1));
    setOptDurationUnit(o.duration_unit);
    setOptPrice(toNum(o.price));
  };

  const fetchPackages = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase
      .from("packages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      showToast(`Load failed: ${error.message}`);
      setPackages([]);
      setOptionsByPackage({});
      setLoading(false);
      return;
    }

    const rows = (data as PackageRow[]) || [];
    setPackages(rows);

    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: optData, error: optErr } = await supabase
        .from("package_options")
        .select("*")
        .in("package_id", ids)
        .order("created_at", { ascending: true });

      if (optErr) {
        console.error(optErr);
        showToast(`Options load failed: ${optErr.message}`);
        setOptionsByPackage({});
      } else {
        const map: Record<string, PackageOptionRow[]> = {};
        ((optData as PackageOptionRow[]) || []).forEach((o) => {
          if (!map[o.package_id]) map[o.package_id] = [];
          map[o.package_id].push(o);
        });
        setOptionsByPackage(map);
      }
    } else {
      setOptionsByPackage({});
    }

    setLoading(false);
  };

  useEffect(() => {
    void fetchPackages();
  }, []);

  const savePackage = async (): Promise<void> => {
    if (!pkgTitle.trim()) return showToast("Title is required.");
    setSaving(true);

    try {
      const userRes = await supabase.auth.getUser();
      const uid = userRes.data.user?.id;

      if (!uid) {
        showToast("Not logged in.");
        return;
      }

      const payload = {
        admin_id: uid,
        area: pkgArea,
        title: pkgTitle.trim(),
        description: pkgDesc.trim() ? pkgDesc.trim() : null,
        amenities: pkgAmenities.trim() ? pkgAmenities.trim() : null,
        is_active: !!pkgActive,
      };

      if (!activePackage) {
        const { data, error } = await supabase.from("packages").insert(payload).select("*").single();
        if (error || !data) return showToast(`Create failed: ${error?.message ?? "Unknown error"}`);
        showToast("Package created.");
      } else {
        const { data, error } = await supabase
          .from("packages")
          .update({
            area: payload.area,
            title: payload.title,
            description: payload.description,
            amenities: payload.amenities,
            is_active: payload.is_active,
          })
          .eq("id", activePackage.id)
          .select("*")
          .single();

        if (error || !data) return showToast(`Update failed: ${error?.message ?? "Unknown error"}`);
        showToast("Package updated.");
      }

      setOpenPackageModal(false);
      setActivePackage(null);
      resetPackageForm();
      await fetchPackages();
    } finally {
      setSaving(false);
    }
  };

  const deletePackage = async (p: PackageRow): Promise<void> => {
    const ok = window.confirm(`Delete package?\n\n${p.title}\n(${p.area})`);
    if (!ok) return;

    setDeletingId(p.id);
    try {
      const { error } = await supabase.from("packages").delete().eq("id", p.id);
      if (error) return showToast(`Delete failed: ${error.message}`);

      showToast("Package deleted.");
      setPackages((prev) => prev.filter((x) => x.id !== p.id));
      setOptionsByPackage((prev) => {
        const copy = { ...prev };
        delete copy[p.id];
        return copy;
      });
      if (activePackage?.id === p.id) {
        setActivePackage(null);
        setOpenOptionsModal(false);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const saveOption = async (): Promise<void> => {
    if (!activePackage) return showToast("No package selected.");
    if (!optName.trim()) return showToast("Option name is required.");
    if (!Number.isFinite(optDurationValue) || optDurationValue <= 0) return showToast("Duration value must be > 0.");
    if (!Number.isFinite(optPrice) || optPrice < 0) return showToast("Price must be >= 0.");

    setSaving(true);
    try {
      const payload = {
        package_id: activePackage.id,
        option_name: optName.trim(),
        duration_value: Math.floor(optDurationValue),
        duration_unit: optDurationUnit,
        price: Number(optPrice),
      };

      if (!editingOption) {
        const { data, error } = await supabase.from("package_options").insert(payload).select("*").single();
        if (error || !data) return showToast(`Add option failed: ${error?.message ?? "Unknown error"}`);
        showToast("Option added.");
      } else {
        const { data, error } = await supabase
          .from("package_options")
          .update(payload)
          .eq("id", editingOption.id)
          .select("*")
          .single();

        if (error || !data) return showToast(`Update option failed: ${error?.message ?? "Unknown error"}`);
        showToast("Option updated.");
      }

      resetOptionForm();
      await fetchOptionsForPackage(activePackage.id);
      await fetchPackages();
    } finally {
      setSaving(false);
    }
  };

  const deleteOption = async (o: PackageOptionRow): Promise<void> => {
    const ok = window.confirm(`Delete option?\n\n${o.option_name}`);
    if (!ok) return;

    setDeletingId(o.id);
    try {
      const { error } = await supabase.from("package_options").delete().eq("id", o.id);
      if (error) return showToast(`Delete option failed: ${error.message}`);

      showToast("Option deleted.");
      if (activePackage) await fetchOptionsForPackage(activePackage.id);
      await fetchPackages();
    } finally {
      setDeletingId(null);
    }
  };

  const formatArea = (a: PackageArea) => (a === "common_area" ? "Common Area" : "Conference Room");

  const formatDuration = (v: number, u: DurationUnit) => {
    const unit =
      u === "hour"
        ? v === 1
          ? "hour"
          : "hours"
        : u === "day"
        ? v === 1
          ? "day"
          : "days"
        : u === "month"
        ? v === 1
          ? "month"
          : "months"
        : v === 1
        ? "year"
        : "years";
    return `${v} ${unit}`;
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Admin Packages</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={openCreatePackage}>
              <IonIcon icon={addOutline} slot="start" />
              New
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding adminpkg">
        <div className="adminpkg__wrap">
          {loading ? (
            <div className="adminpkg__loading">
              <IonSpinner />
              <IonText className="adminpkg__muted" style={{ marginTop: 10 }}>
                Loading packages...
              </IonText>
            </div>
          ) : packages.length === 0 ? (
            <IonText>No packages yet. Click “New”.</IonText>
          ) : (
            <IonGrid className="adminpkg__grid">
              <IonRow>
                {packages.map((p) => {
                  const opts = optionsByPackage[p.id] || [];
                  return (
                    <IonCol size="12" sizeMd="6" key={p.id}>
                      <IonCard className="adminpkg__card">
                        <IonCardHeader>
                          <IonCardTitle className="adminpkg__cardTitle">
                            <span className="adminpkg__titleText">{p.title}</span>
                            <IonBadge color={p.is_active ? "success" : "medium"}>
                              {p.is_active ? "ACTIVE" : "INACTIVE"}
                            </IonBadge>
                          </IonCardTitle>

                          <div className="adminpkg__chips">
                            <IonChip>{formatArea(p.area)}</IonChip>
                            <IonChip>
                              {opts.length} option{opts.length !== 1 ? "s" : ""}
                            </IonChip>
                          </div>
                        </IonCardHeader>

                        <IonCardContent>
                          {p.description ? (
                            <IonText>
                              <p className="adminpkg__desc">{p.description}</p>
                            </IonText>
                          ) : null}

                          {p.amenities ? (
                            <div className="adminpkg__amenities">
                              <IonText>
                                <strong>AMENITIES</strong>
                              </IonText>
                              <ul className="adminpkg__amenityList">
                                {p.amenities
                                  .split("\n")
                                  .map((line) => line.replace("•", "").trim())
                                  .filter(Boolean)
                                  .map((line, idx) => (
                                    <li key={idx}>{line}</li>
                                  ))}
                              </ul>
                            </div>
                          ) : null}

                          {opts.length > 0 ? (
                            <div className="adminpkg__options">
                              <IonText>
                                <strong>OPTIONS</strong>
                              </IonText>

                              <div className="adminpkg__optionGrid">
                                {opts.slice(0, 6).map((o) => (
                                  <div className="adminpkg__optionRow" key={o.id}>
                                    <div className="adminpkg__optionLeft">
                                      <strong>{o.option_name}</strong>
                                      <small className="adminpkg__muted">
                                        {formatDuration(Number(o.duration_value), o.duration_unit)}
                                      </small>
                                    </div>
                                    <div className="adminpkg__optionRight">₱{toNum(o.price).toFixed(2)}</div>
                                  </div>
                                ))}
                                {opts.length > 6 ? (
                                  <IonText color="medium">
                                    <small>+{opts.length - 6} more…</small>
                                  </IonText>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <IonText color="medium">
                              <p className="adminpkg__muted" style={{ marginTop: 10 }}>
                                No options yet. Add options.
                              </p>
                            </IonText>
                          )}

                          <div className="adminpkg__actions">
                            <IonButton size="small" onClick={() => openEditPackage(p)}>
                              <IonIcon icon={createOutline} slot="start" />
                              Edit
                            </IonButton>

                            <IonButton size="small" onClick={() => void openManageOptions(p)}>
                              Manage Options
                            </IonButton>

                            <IonButton
                              size="small"
                              color="danger"
                              disabled={deletingId === p.id}
                              onClick={() => void deletePackage(p)}
                            >
                              <IonIcon icon={trashOutline} slot="start" />
                              {deletingId === p.id ? "Deleting..." : "Delete"}
                            </IonButton>
                          </div>
                        </IonCardContent>
                      </IonCard>
                    </IonCol>
                  );
                })}
              </IonRow>
            </IonGrid>
          )}
        </div>

        {/* =========================
            PACKAGE MODAL
        ========================= */}
        <IonModal isOpen={openPackageModal} onDidDismiss={() => setOpenPackageModal(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{activePackage ? "Edit Package" : "New Package"}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setOpenPackageModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding adminpkg">
            <IonList className="adminpkg__list">
              <IonItem>
                <IonLabel position="stacked">Area</IonLabel>
                <IonSelect value={pkgArea} onIonChange={(e) => setPkgArea(e.detail.value as PackageArea)}>
                  <IonSelectOption value="common_area">Common Area</IonSelectOption>
                  <IonSelectOption value="conference_room">Conference Room</IonSelectOption>
                </IonSelect>
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Title</IonLabel>
                <IonInput value={pkgTitle} onIonChange={(e) => setPkgTitle(e.detail.value ?? "")} />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Description (optional)</IonLabel>
                <IonTextarea autoGrow value={pkgDesc} onIonChange={(e) => setPkgDesc(e.detail.value ?? "")} />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">AMENITIES (optional)</IonLabel>
                <IonTextarea
                  autoGrow
                  placeholder={"Example:\n• Free Wi-Fi\n• Unlimited coffee\n• Printing services available"}
                  value={pkgAmenities}
                  onIonChange={(e) => setPkgAmenities(e.detail.value ?? "")}
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Active?</IonLabel>
                <IonSelect value={pkgActive ? "yes" : "no"} onIonChange={(e) => setPkgActive(e.detail.value === "yes")}>
                  <IonSelectOption value="yes">Active</IonSelectOption>
                  <IonSelectOption value="no">Inactive</IonSelectOption>
                </IonSelect>
              </IonItem>
            </IonList>

            <div className="adminpkg__modalActions">
              <IonButton expand="block" disabled={saving} onClick={() => void savePackage()}>
                {saving ? "Saving..." : "Save"}
              </IonButton>
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => {
                  setOpenPackageModal(false);
                  setActivePackage(null);
                }}
              >
                Cancel
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        {/* =========================
            OPTIONS MODAL
        ========================= */}
        <IonModal isOpen={openOptionsModal} onDidDismiss={() => setOpenOptionsModal(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Options — {activePackage?.title ?? ""}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setOpenOptionsModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding adminpkg">
            {!activePackage ? (
              <IonText>No package selected.</IonText>
            ) : (
              <>
                <IonCard className="adminpkg__card">
                  <IonCardHeader>
                    <IonCardTitle>{editingOption ? "Edit Option" : "Add Option"}</IonCardTitle>
                  </IonCardHeader>
                  <IonCardContent>
                    <IonList className="adminpkg__list">
                      <IonItem>
                        <IonLabel position="stacked">Option Name</IonLabel>
                        <IonInput value={optName} onIonChange={(e) => setOptName(e.detail.value ?? "")} />
                      </IonItem>

                      <IonItem>
                        <IonLabel position="stacked">Duration Value</IonLabel>
                        <IonInput
                          type="number"
                          value={String(optDurationValue)}
                          onIonChange={(e) => setOptDurationValue(Number(e.detail.value ?? 1))}
                        />
                      </IonItem>

                      <IonItem>
                        <IonLabel position="stacked">Duration Unit</IonLabel>
                        <IonSelect value={optDurationUnit} onIonChange={(e) => setOptDurationUnit(e.detail.value as DurationUnit)}>
                          <IonSelectOption value="hour">Hour(s)</IonSelectOption>
                          <IonSelectOption value="day">Day(s)</IonSelectOption>
                          <IonSelectOption value="month">Month(s)</IonSelectOption>
                          <IonSelectOption value="year">Year(s)</IonSelectOption>
                        </IonSelect>
                      </IonItem>

                      <IonItem>
                        <IonLabel position="stacked">Price (PHP)</IonLabel>
                        <IonInput type="number" value={String(optPrice)} onIonChange={(e) => setOptPrice(Number(e.detail.value ?? 0))} />
                      </IonItem>
                    </IonList>

                    <div className="adminpkg__optionActions">
                      <IonButton disabled={saving} onClick={() => void saveOption()}>
                        {saving ? "Saving..." : editingOption ? "Update Option" : "Add Option"}
                      </IonButton>
                      <IonButton fill="outline" onClick={resetOptionForm}>
                        Clear
                      </IonButton>
                    </div>
                  </IonCardContent>
                </IonCard>

                <IonList className="adminpkg__list">
                  <IonListHeader>
                    <IonLabel>Saved Options</IonLabel>
                  </IonListHeader>

                  {selectedOptions.length === 0 ? (
                    <IonItem>
                      <IonLabel>No options yet.</IonLabel>
                    </IonItem>
                  ) : (
                    selectedOptions.map((o) => (
                      <IonItem key={o.id}>
                        <IonLabel>
                          <strong>{o.option_name}</strong>
                          <div className="adminpkg__muted" style={{ fontSize: 12 }}>
                            {formatDuration(Number(o.duration_value), o.duration_unit)}
                          </div>
                        </IonLabel>

                        <IonText className="adminpkg__price">₱{toNum(o.price).toFixed(2)}</IonText>

                        <IonButton size="small" fill="outline" onClick={() => openEditOption(o)} style={{ marginRight: 8 }}>
                          Edit
                        </IonButton>

                        <IonButton size="small" color="danger" disabled={deletingId === o.id} onClick={() => void deleteOption(o)}>
                          {deletingId === o.id ? "..." : "Delete"}
                        </IonButton>
                      </IonItem>
                    ))
                  )}
                </IonList>
              </>
            )}
          </IonContent>
        </IonModal>

        <IonToast isOpen={toastOpen} message={toastMsg} duration={2200} onDidDismiss={() => setToastOpen(false)} />
      </IonContent>
    </IonPage>
  );
};

export default Admin_Packages;
