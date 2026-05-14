import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Incident, type IncidentPriority } from "../lib/api";
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { resolveAddressFromCoordinates } from "../lib/addressFromPoint";
import { ResponderMapWebView } from "./ResponderMapWebView";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";

/** Aligned with `dispatcher/src/components/CreateIncidentModal.tsx` */
const CRIME_SUBTYPES = [
  "Theft",
  "Assault",
  "Smuggling",
  "Drug Dealing",
  "Illegal Brewery",
  "Defilement",
  "Theft of Livestock",
  "Malicious Acts",
  "Homicide",
  "Genocide Ideology",
] as const;

const OTHER_SUBTYPES = [
  "Heavy Rain Destruction",
  "Sudden Death",
  "Dead Body Recovered",
  "Suspected Suicide",
  "Fire Incident",
  "UXO Recovered",
  "Drowning",
  "Human Remains Recovered",
  "Lightning Strike",
  "Mine Collapse",
] as const;

const ACCIDENT_SUBTYPES = [
  "Reckless Driving",
  "Failure to Respect Safe Distance",
  "Failure to Adjust Speed",
  "Wrong Overtaking",
  "Violation of Right of Way",
  "Failure to Drive on the Right Side of the Roadway",
  "Failure to Use Side Mirror",
  "Wrong Maneuvering",
  "Drunkenness",
  "Pedestrian Behavior",
] as const;

type SubtypeGroup = "crime" | "other" | "accidents";

type IncidentCategory = "FIRE" | "MEDICAL" | "TRAFFIC" | "CRIME" | "HAZMAT" | "OTHER";

const PRIORITIES: IncidentPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

type CreateIncidentModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Current GPS fix; incident location is required and must be in Rwanda. */
  location: { lat: number; lon: number } | null;
  onCreated?: (incident: Incident) => void;
};

export function CreateIncidentModal({ visible, onClose, location, onCreated }: CreateIncidentModalProps) {
  const { user } = useAuthMobile();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createIncidentModalStyles(theme), [theme]);

  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [pickMapOpen, setPickMapOpen] = useState(false);
  const [geocodingPick, setGeocodingPick] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<IncidentCategory>("OTHER");
  const [priority, setPriority] = useState<IncidentPriority>("MEDIUM");
  const [address, setAddress] = useState("");
  const [callerPhone, setCallerPhone] = useState("");
  const [callerName, setCallerName] = useState("");
  const [callTime, setCallTime] = useState("");
  const [subtype, setSubtype] = useState("");
  const [subtypeGroup, setSubtypeGroup] = useState<SubtypeGroup>("other");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [sector, setSector] = useState("");
  const [cell, setCell] = useState("");
  const [village, setVillage] = useState("");
  const [witnessName, setWitnessName] = useState("");
  const [witnessPhone, setWitnessPhone] = useState("");
  const [witnessEmail, setWitnessEmail] = useState("");
  const [witnessNotes, setWitnessNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatCallTimeNow = useCallback(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }, []);

  const clearForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setCategory("OTHER");
    setPriority("MEDIUM");
    setAddress("");
    setCallerPhone("");
    setCallerName("");
    setCallTime(formatCallTimeNow());
    setSubtype("");
    setSubtypeGroup("other");
    setProvince("");
    setDistrict("");
    setSector("");
    setCell("");
    setVillage("");
    setWitnessName("");
    setWitnessPhone("");
    setWitnessEmail("");
    setWitnessNotes("");
    setPickedCoords(null);
  }, [formatCallTimeNow]);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    // Prefill call time when opening the form so responder doesn't type it manually.
    if (!callTime.trim()) {
      setCallTime(formatCallTimeNow());
    }
  }, [visible, callTime, formatCallTimeNow]);

  const coordsForSubmit = pickedCoords ?? location;

  const submit = useCallback(async () => {
    setError(null);
    if (!coordsForSubmit) {
      setError("Use GPS, or pick a point on the map to set the incident location.");
      return;
    }
    const t = title.trim();
    const d = description.trim();
    if (t.length < 3) {
      setError("Title must be at least 3 characters.");
      return;
    }
    if (d.length < 5) {
      setError("Description must be at least 5 characters.");
      return;
    }

    const addressToSave = address.trim() || undefined;
    const mergedDetails: Record<string, unknown> = {
      callerName: callerName.trim() || undefined,
      callTime: callTime.trim() || formatCallTimeNow(),
      subtype: subtype.trim() || undefined,
      address: {
        province: province.trim() || undefined,
        district: district.trim() || undefined,
        sector: sector.trim() || undefined,
        cell: cell.trim() || undefined,
        village: village.trim() || undefined,
      },
      witness: {
        name: witnessName.trim() || undefined,
        phone: witnessPhone.trim() || undefined,
        email: witnessEmail.trim() || undefined,
        notes: witnessNotes.trim() || undefined,
      },
    };

    setSubmitting(true);
    try {
      const incident = await api.createIncident({
        title: t,
        description: d,
        status: "NEW",
        priority,
        category,
        location: {
          lat: coordsForSubmit.lat,
          lon: coordsForSubmit.lon,
          address: addressToSave,
        },
        callerPhone: callerPhone.trim() || undefined,
        details: mergedDetails,
      });
      clearForm();
      onCreated?.(incident);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create incident.");
    } finally {
      setSubmitting(false);
    }
  }, [
    address,
    callTime,
    callerName,
    callerPhone,
    category,
    cell,
    clearForm,
    coordsForSubmit,
    description,
    district,
    onClose,
    onCreated,
    priority,
    province,
    sector,
    subtype,
    title,
    user?.id,
    user?.name,
    village,
    witnessEmail,
    witnessName,
    witnessNotes,
    witnessPhone,
  ]);

  const subtypeOptions =
    subtypeGroup === "crime" ? CRIME_SUBTYPES : subtypeGroup === "accidents" ? ACCIDENT_SUBTYPES : OTHER_SUBTYPES;

  return (
    <React.Fragment>
      <Modal visible={visible && !pickMapOpen} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New incident</Text>
            <Button title="Cancel" variant="secondary" onPress={onClose} disabled={submitting} />
          </View>
          <Text style={styles.hint}>
            Same fields as dispatcher CAD. Sent to dispatch for assignment; track under History.
          </Text>
          {!coordsForSubmit ? (
            <Text style={styles.warn}>
              Enable location for GPS, or use &quot;Pick on map&quot; in Address to set coordinates.
            </Text>
          ) : (
            <Text style={styles.locHint}>
              {pickedCoords ? "Map pick" : "GPS"}: {coordsForSubmit.lat.toFixed(5)}, {coordsForSubmit.lon.toFixed(5)}{" "}
              (Rwanda)
            </Text>
          )}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form} nestedScrollEnabled>
            <CollapsibleSection styles={styles} title="General" defaultOpen>
              <Text style={styles.label}>Incident title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Short title"
                placeholderTextColor={theme.color.textSubtle}
              />

              <Text style={styles.label}>Incident type</Text>
              <View style={styles.groupRow}>
                {(
                  [
                    { key: "crime" as const, label: "Crime" },
                    { key: "accidents" as const, label: "Accidents" },
                    { key: "other" as const, label: "Other" },
                  ] as const
                ).map(({ key, label }) => (
                  <Chip key={key} label={label} selected={subtypeGroup === key} onPress={() => setSubtypeGroup(key)} />
                ))}
              </View>
              <View style={styles.subtypeGrid}>
                {subtypeOptions.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    selected={subtype === s}
                    onPress={() => {
                      setSubtype(s);
                      if (subtypeGroup === "crime") setCategory("CRIME");
                      else if (subtypeGroup === "accidents") setCategory("TRAFFIC");
                      else setCategory("OTHER");
                    }}
                  />
                ))}
              </View>
              <Text style={styles.label}>Or custom incident type</Text>
              <View style={styles.rowInline}>
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  value={subtype}
                  onChangeText={setSubtype}
                  placeholder="Custom type"
                  placeholderTextColor={theme.color.textSubtle}
                />
                <Button title="Clear" variant="secondary" onPress={() => setSubtype("")} />
              </View>

              <Text style={styles.label}>What happened</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={description}
                onChangeText={setDescription}
                placeholder="Describe what happened"
                placeholderTextColor={theme.color.textSubtle}
                multiline
              />

              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.label}>Caller name (optional)</Text>
                  <TextInput style={styles.input} value={callerName} onChangeText={setCallerName} placeholder="Name" placeholderTextColor={theme.color.textSubtle} />
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Call time (auto)</Text>
                  <TextInput
                    style={styles.input}
                    value={callTime}
                    onChangeText={setCallTime}
                    placeholder="Auto-filled"
                    placeholderTextColor={theme.color.textSubtle}
                  />
                  <View style={{ marginTop: 8 }}>
                    <Button title="Use current time" variant="secondary" onPress={() => setCallTime(formatCallTimeNow())} />
                  </View>
                </View>
              </View>

              <Text style={styles.label}>Urgency</Text>
              <View style={styles.chips}>
                {PRIORITIES.map((p) => (
                  <Chip key={p} label={p} selected={priority === p} onPress={() => setPriority(p)} />
                ))}
              </View>

              <Text style={styles.label}>Caller phone (optional)</Text>
              <TextInput
                style={styles.input}
                value={callerPhone}
                onChangeText={setCallerPhone}
                placeholder="+250 7xx xxx xxx"
                placeholderTextColor={theme.color.textSubtle}
                keyboardType="phone-pad"
              />
            </CollapsibleSection>

            <CollapsibleSection styles={styles} title="Address" defaultOpen>
              <Button title="Pick on map" variant="secondary" onPress={() => setPickMapOpen(true)} />
              <Text style={styles.pickMapHint}>
                Tap the map to place the incident. Rwanda admin fields and address line fill automatically (same as
                dispatcher CAD).
              </Text>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.label}>Province</Text>
                  <TextInput style={styles.input} value={province} onChangeText={setProvince} placeholder="Province" placeholderTextColor={theme.color.textSubtle} />
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>District</Text>
                  <TextInput style={styles.input} value={district} onChangeText={setDistrict} placeholder="District" placeholderTextColor={theme.color.textSubtle} />
                </View>
              </View>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.label}>Sector</Text>
                  <TextInput style={styles.input} value={sector} onChangeText={setSector} placeholder="Sector" placeholderTextColor={theme.color.textSubtle} />
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Cell</Text>
                  <TextInput style={styles.input} value={cell} onChangeText={setCell} placeholder="Cell" placeholderTextColor={theme.color.textSubtle} />
                </View>
              </View>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.label}>Village</Text>
                  <TextInput style={styles.input} value={village} onChangeText={setVillage} placeholder="Village" placeholderTextColor={theme.color.textSubtle} />
                </View>
                <View style={styles.col} />
              </View>
              <Text style={styles.label}>Location / address line (optional)</Text>
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={setAddress}
                placeholder="Street, landmark, directions"
                placeholderTextColor={theme.color.textSubtle}
              />
            </CollapsibleSection>

            <CollapsibleSection styles={styles} title="Witness" defaultOpen={false}>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.label}>Name</Text>
                  <TextInput style={styles.input} value={witnessName} onChangeText={setWitnessName} placeholder="Name" placeholderTextColor={theme.color.textSubtle} />
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Phone</Text>
                  <TextInput
                    style={styles.input}
                    value={witnessPhone}
                    onChangeText={setWitnessPhone}
                    placeholder="Phone"
                    placeholderTextColor={theme.color.textSubtle}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={witnessEmail}
                onChangeText={setWitnessEmail}
                placeholder="witness@email.com"
                placeholderTextColor={theme.color.textSubtle}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={witnessNotes}
                onChangeText={setWitnessNotes}
                placeholder="Optional notes"
                placeholderTextColor={theme.color.textSubtle}
                multiline
              />
            </CollapsibleSection>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              title={submitting ? "Submitting..." : "Submit to dispatch"}
              onPress={() => void submit()}
              disabled={!coordsForSubmit || submitting}
              loading={submitting}
            />
          </ScrollView>
        </View>
      </View>
      </Modal>

      <Modal visible={pickMapOpen} animationType="slide" onRequestClose={() => setPickMapOpen(false)}>
        <View style={styles.pickMapRoot}>
          <ResponderMapWebView
            pickMode
            syncResponderLocation={false}
            focusTarget={
              pickedCoords
                ? { lat: pickedCoords.lat, lon: pickedCoords.lon }
                : location
                  ? { lat: location.lat, lon: location.lon }
                  : { lat: -1.9441, lon: 30.0588 }
            }
            onMapPick={(lat, lon) => {
              void (async () => {
                setGeocodingPick(true);
                try {
                  const r = await resolveAddressFromCoordinates(lat, lon);
                  setPickedCoords({ lat, lon });
                  if (r.province) setProvince(r.province);
                  if (r.district) setDistrict(r.district);
                  if (r.sector) setSector(r.sector);
                  if (r.cell) setCell(r.cell);
                  if (r.village) setVillage(r.village);
                  if (r.addressLine) setAddress(r.addressLine);
                  setPickMapOpen(false);
                } finally {
                  setGeocodingPick(false);
                }
              })();
            }}
          />
          <View style={[styles.pickMapTopBar, { paddingTop: insets.top + 8 }]}>
            <Pressable style={styles.pickMapCancel} onPress={() => setPickMapOpen(false)} disabled={geocodingPick}>
              <Text style={styles.pickMapCancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.pickMapTitle}>Tap map to place incident</Text>
            <View style={{ width: 64 }} />
          </View>
          {geocodingPick ? (
            <View style={styles.geocodeOverlay}>
              <ActivityIndicator size="large" color={theme.color.white} />
              <Text style={styles.geocodeText}>Resolving address…</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </React.Fragment>
  );
}

function createIncidentModalStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.color.backdrop, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "94%",
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.sheetTop,
    borderTopRightRadius: theme.radius.sheetTop,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: theme.color.border,
    paddingBottom: 16,
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 10,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: theme.color.text, flex: 1 },
  hint: { color: theme.color.textMuted, fontSize: 13, paddingHorizontal: 16, marginBottom: 6, fontWeight: "700" },
  warn: { color: theme.color.warn, fontSize: 13, paddingHorizontal: 16, marginBottom: 4, fontWeight: "800" },
  locHint: { color: theme.color.textMuted, fontSize: 12, paddingHorizontal: 16, marginBottom: 8, fontWeight: "700" },
  form: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionCard: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: theme.color.card,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.color.card,
  },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: theme.color.text },
  sectionChevron: { fontSize: 12, color: theme.color.textMuted, fontWeight: "900" },
  sectionBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4 },
  label: { fontWeight: "900", color: theme.color.textSubtle, marginBottom: 6, marginTop: 10, fontSize: 12, letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.color.text,
    backgroundColor: theme.color.cardSolid,
    fontWeight: "700",
  },
  inputFlex: { flex: 1 },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  groupRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  subtypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  twoCol: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  rowInline: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { color: theme.color.dangerTextSoft, marginTop: 12, fontSize: 13, fontWeight: "800" },
  pickMapHint: { color: theme.color.textMuted, fontSize: 12, marginTop: 8, marginBottom: 4, fontWeight: "700" },
  pickMapRoot: { flex: 1, backgroundColor: theme.color.black },
  pickMapTopBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: theme.color.surface,
  },
  pickMapCancel: { padding: 8 },
  pickMapCancelText: { color: theme.color.primary2, fontWeight: "900", fontSize: 15 },
  pickMapTitle: { color: theme.color.text, fontWeight: "700", fontSize: 13, flex: 1, textAlign: "center" },
  geocodeOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.color.backdrop,
    alignItems: "center",
    justifyContent: "center",
  },
  geocodeText: { color: theme.color.text, marginTop: 12, fontWeight: "600" },
  });
}

function CollapsibleSection({
  styles,
  title,
  children,
  defaultOpen = true,
}: {
  styles: ReturnType<typeof createIncidentModalStyles>;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.sectionCard}>
      <Pressable style={styles.sectionHeader} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionChevron}>{open ? "▼" : "▶"}</Text>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}
