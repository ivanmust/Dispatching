import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateIncident, useUpdateIncident } from '@/hooks/useIncidents';
import type { Incident, IncidentCategory, IncidentPriority } from '@/types/incident';
import { toast } from '@/hooks/use-toast';
import { MapPin } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const CRIME_SUBTYPES = [
  'Theft',
  'Assault',
  'Smuggling',
  'Drug Dealing',
  'Illegal Brewery',
  'Defilement',
  'Theft of Livestock',
  'Malicious Acts',
  'Homicide',
  'Genocide Ideology',
] as const;

const OTHER_SUBTYPES = [
  'Heavy Rain Destruction',
  'Sudden Death',
  'Dead Body Recovered',
  'Suspected Suicide',
  'Fire Incident',
  'UXO Recovered',
  'Drowning',
  'Human Remains Recovered',
  'Lightning Strike',
  'Mine Collapse',
] as const;

const ACCIDENT_SUBTYPES = [
  'Reckless Driving',
  'Failure to Respect Safe Distance',
  'Failure to Adjust Speed',
  'Wrong Overtaking',
  'Violation of Right of Way',
  'Failure to Drive on the Right Side of the Roadway',
  'Failure to Use Side Mirror',
  'Wrong Maneuvering',
  'Drunkenness',
  'Pedestrian Behavior',
] as const;

function isInList(value: string, list: readonly string[]): boolean {
  return list.includes(value);
}

function getRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function getString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

function getCreateIncidentErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Failed to create incident';
  if (msg.includes('Coordinates must be within Rwanda')) {
    return 'Pick a location inside Rwanda before creating the incident.';
  }
  if (msg.includes('Dispatcher incident creation is disabled by admin')) {
    return 'Dispatcher incident creation is currently disabled in admin settings.';
  }
  if (msg.includes('Creator fields are server-managed')) {
    return 'The app sent an outdated create request. Refresh the dispatcher page and try again.';
  }
  return msg;
}

function buildFullAddressLabel(input: {
  address?: string;
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
}): string {
  const road = (input.address ?? '').trim();
  const admin = [input.village, input.cell, input.sector, input.district, input.province]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(', ');
  if (road && admin && !road.toLowerCase().includes(admin.toLowerCase())) return `${road} — ${admin}`;
  return road || admin;
}

interface CreateIncidentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnablePickMode: () => void;
  pickedLocation: {
    lat: number;
    lon: number;
    address?: string;
    province?: string;
    district?: string;
    sector?: string;
    cell?: string;
    village?: string;
  } | null;
  incidentToEdit?: Incident | null;
  onSaved?: (incident: Incident) => void;
}

export function CreateIncidentModal({
  open,
  onOpenChange,
  onEnablePickMode,
  pickedLocation,
  incidentToEdit = null,
  onSaved,
}: CreateIncidentModalProps) {
  const createMutation = useCreateIncident();
  const updateMutation = useUpdateIncident();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('OTHER');
  const [priority, setPriority] = useState<IncidentPriority>('MEDIUM');
  const [address, setAddress] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callTime, setCallTime] = useState(''); // datetime-local value
  const [subtype, setSubtype] = useState('');
  const [subtypeGroup, setSubtypeGroup] = useState<'crime' | 'other' | 'accidents'>('other');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [sector, setSector] = useState('');
  const [cell, setCell] = useState('');
  const [village, setVillage] = useState('');
  const [witnessName, setWitnessName] = useState('');
  const [witnessPhone, setWitnessPhone] = useState('');
  const [witnessEmail, setWitnessEmail] = useState('');
  const [witnessNotes, setWitnessNotes] = useState('');

  const isEdit = !!incidentToEdit?.id;

  const editDefaults = useMemo(() => {
    const d = getRecord(incidentToEdit?.details);
    const addr = getRecord(d.address);
    const wit = getRecord(d.witness);
    return {
      title: incidentToEdit?.title ?? '',
      description: incidentToEdit?.description ?? '',
      category: (incidentToEdit?.category ?? 'OTHER') as IncidentCategory,
      priority: (incidentToEdit?.priority ?? 'MEDIUM') as IncidentPriority,
      locationAddress: incidentToEdit?.location?.address ?? '',
      callerPhone: incidentToEdit?.callerPhone ?? '',
        callerName: getString(d, 'callerName'),
        callTime: getString(d, 'callTime'),
      subtype: getString(d, 'subtype'),
      province: getString(addr, 'province'),
      district: getString(addr, 'district'),
      sector: getString(addr, 'sector'),
      cell: getString(addr, 'cell'),
      village: getString(addr, 'village'),
      witnessName: getString(wit, 'name'),
      witnessPhone: getString(wit, 'phone'),
        witnessEmail: getString(wit, 'email'),
      witnessNotes: getString(wit, 'notes'),
    };
  }, [incidentToEdit]);

  const clearForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setCategory('OTHER');
    setPriority('MEDIUM');
    setAddress('');
    setCallerPhone('');
    setCallerName('');
    setCallTime('');
    setSubtype('');
    setSubtypeGroup('other');
    setProvince('');
    setDistrict('');
    setSector('');
    setCell('');
    setVillage('');
    setWitnessName('');
    setWitnessPhone('');
    setWitnessEmail('');
    setWitnessNotes('');
  }, []);

  /** New incident: start blank. Edit incident: load fields from the selected row (not leftover create state). */
  useEffect(() => {
    if (!open) return;
    if (incidentToEdit) return;
    // Parent still holds `pickedLocation` after map pick while the modal was closed; clearing here would
    // wipe the address field (and anything typed before pick) because `pickedLocation` does not change
    // again when the modal reopens, so the sync effect below never re-runs.
    if (pickedLocation) return;
    clearForm();
  }, [open, incidentToEdit, pickedLocation, clearForm]);

  useEffect(() => {
    if (!open) return;
    if (!incidentToEdit) return;
    setTitle(editDefaults.title);
    setDescription(editDefaults.description);
    setCategory(editDefaults.category);
    setPriority(editDefaults.priority);
    setAddress(editDefaults.locationAddress);
    setCallerPhone(editDefaults.callerPhone);
    setCallerName(editDefaults.callerName);
    setCallTime(editDefaults.callTime);
    setSubtype(editDefaults.subtype);
    setSubtypeGroup(editDefaults.category === 'CRIME' ? 'crime' : editDefaults.category === 'TRAFFIC' ? 'accidents' : 'other');
    setProvince(editDefaults.province);
    setDistrict(editDefaults.district);
    setSector(editDefaults.sector);
    setCell(editDefaults.cell);
    setVillage(editDefaults.village);
    setWitnessName(editDefaults.witnessName);
    setWitnessPhone(editDefaults.witnessPhone);
    setWitnessEmail(editDefaults.witnessEmail);
    setWitnessNotes(editDefaults.witnessNotes);
  }, [open, incidentToEdit, editDefaults]);

  // Auto-fill address and admin fields when a location was picked (sync whenever modal is open).
  useEffect(() => {
    if (!open || !pickedLocation) return;
    setAddress(
      buildFullAddressLabel({
        address: pickedLocation.address,
        province: pickedLocation.province,
        district: pickedLocation.district,
        sector: pickedLocation.sector,
        cell: pickedLocation.cell,
        village: pickedLocation.village,
      }),
    );
    if (pickedLocation.province != null) setProvince(pickedLocation.province);
    if (pickedLocation.district != null) setDistrict(pickedLocation.district);
    if (pickedLocation.sector != null) setSector(pickedLocation.sector);
    if (pickedLocation.cell != null) setCell(pickedLocation.cell);
    if (pickedLocation.village != null) setVillage(pickedLocation.village);
  }, [open, pickedLocation]);

  const handleSave = () => {
    if (title.trim().length < 3) {
      toast({ title: 'Validation error', description: 'Title must be at least 3 characters', variant: 'destructive' });
      return;
    }
    if (description.trim().length < 5) {
      toast({ title: 'Validation error', description: 'Description must be at least 5 characters', variant: 'destructive' });
      return;
    }
    const baseLoc = isEdit ? incidentToEdit!.location : { lat: -1.9441, lon: 30.0588 };
    const loc = pickedLocation ?? baseLoc;
    const addressToSave = address.trim() || pickedLocation?.address || undefined;
    const mergedDetails: Record<string, unknown> = {
      ...(((incidentToEdit?.details ?? {}) as Record<string, unknown>) || {}),
      callerName: callerName.trim() || undefined,
      callTime: callTime || undefined,
      subtype: subtype.trim() || undefined,
      address: {
        ...getRecord(getRecord(incidentToEdit?.details).address),
        province: province.trim() || undefined,
        district: district.trim() || undefined,
        sector: sector.trim() || undefined,
        cell: cell.trim() || undefined,
        village: village.trim() || undefined,
      },
      witness: {
        ...getRecord(getRecord(incidentToEdit?.details).witness),
        name: witnessName.trim() || undefined,
        phone: witnessPhone.trim() || undefined,
        email: witnessEmail.trim() || undefined,
        notes: witnessNotes.trim() || undefined,
      },
    };

    if (isEdit) {
      updateMutation.mutate(
        {
          id: incidentToEdit!.id,
          updates: {
            title: title.trim(),
            description: description.trim(),
            category,
            priority,
            location: { ...loc, address: addressToSave },
            callerPhone: callerPhone.trim() || undefined,
            details: mergedDetails,
          },
        },
        {
          onSuccess: (updated) => {
            toast({ title: 'Incident updated', description: title });
            onSaved?.(updated);
            onOpenChange(false);
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Could not save changes';
            toast({ title: 'Update failed', description: msg, variant: 'destructive' });
          },
        }
      );
      return;
    }

    createMutation.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        // Backend enforces NEW ("Unassigned") on create.
        status: 'NEW',
        location: { ...loc, address: addressToSave },
        callerPhone: callerPhone.trim() || undefined,
        details: mergedDetails,
      },
      {
        onSuccess: (created) => {
          toast({ title: 'Incident Created', description: title });
          onSaved?.(created);
          clearForm();
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = getCreateIncidentErrorMessage(err);
          toast({ title: 'Create failed', description: msg, variant: 'destructive' });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="w-[96vw] max-w-4xl max-h-[90vh] overflow-hidden flex flex-col min-h-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit incident' : 'New incident'}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isEdit ? 'Update incident details and save changes.' : 'Capture incident details and location to create a new incident.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="space-y-3 pb-4">
            <Accordion type="multiple" defaultValue={['general', 'address']} className="w-full space-y-3">
              <AccordionItem value="general" className="w-full overflow-hidden rounded-xl border bg-card">
                <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
                  <span className="text-[13px] font-semibold">General</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Incident title</Label>
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Short title" className="h-9" />
                  </div>

                  <div>
                    <Label className="text-xs">Incident Type</Label>
                    <Tabs value={subtypeGroup} onValueChange={(v) => setSubtypeGroup(v as 'crime' | 'other' | 'accidents')}>
                      <TabsList className="h-9 w-full grid grid-cols-3">
                        <TabsTrigger className="text-xs px-2" value="crime">Crime</TabsTrigger>
                        <TabsTrigger className="text-xs px-2" value="accidents">Accidents</TabsTrigger>
                        <TabsTrigger className="text-xs px-2" value="other">Other Incident</TabsTrigger>
                      </TabsList>
                      <TabsContent value="crime" className="mt-2">
                        <Select
                          value={isInList(subtype, CRIME_SUBTYPES) ? subtype : ''}
                          onValueChange={(v) => {
                            setSubtype(v);
                            setCategory('CRIME');
                          }}
                        >
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select crime type" /></SelectTrigger>
                          <SelectContent>
                            {CRIME_SUBTYPES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TabsContent>
                      <TabsContent value="other" className="mt-2">
                        <Select
                          value={isInList(subtype, OTHER_SUBTYPES) ? subtype : ''}
                          onValueChange={(v) => {
                            setSubtype(v);
                            setCategory('OTHER');
                          }}
                        >
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select other type" /></SelectTrigger>
                          <SelectContent>
                            {OTHER_SUBTYPES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TabsContent>
                      <TabsContent value="accidents" className="mt-2">
                        <Select
                          value={isInList(subtype, ACCIDENT_SUBTYPES) ? subtype : ''}
                          onValueChange={(v) => {
                            setSubtype(v);
                            setCategory('TRAFFIC');
                          }}
                        >
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select accident type" /></SelectTrigger>
                          <SelectContent>
                            {ACCIDENT_SUBTYPES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TabsContent>
                    </Tabs>

                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        value={subtype}
                        onChange={(e) => setSubtype(e.target.value)}
                        placeholder="Or type a custom incident type"
                        className="h-9"
                      />
                      <Button type="button" variant="outline" size="sm" className="h-9 text-xs" onClick={() => setSubtype('')}>
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">What happened</Label>
                    <Textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe what happened"
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Caller name (optional)</Label>
                      <Input
                        value={callerName}
                        onChange={(e) => setCallerName(e.target.value)}
                        placeholder="Caller name"
                        className="h-9 text-xs mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Call time (optional)</Label>
                      <Input
                        type="datetime-local"
                        value={callTime}
                        onChange={(e) => setCallTime(e.target.value)}
                        className="h-9 text-xs mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Urgency</Label>
                      <Select value={priority} onValueChange={v => setPriority(v as IncidentPriority)}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as IncidentPriority[]).map(p => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Caller phone (optional)</Label>
                      <Input
                        value={callerPhone}
                        onChange={(e) => setCallerPhone(e.target.value)}
                        placeholder="+250 7xx xxx xxx"
                        className="h-9 text-xs mt-1"
                      />
                    </div>
                  </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

            <AccordionItem value="address" className="w-full overflow-hidden rounded-xl border bg-card">
              <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
                <span className="text-[13px] font-semibold">Address</span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Province</Label>
                      <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Province" className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs">District</Label>
                      <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="District" className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs">Sector</Label>
                      <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Sector" className="h-9" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Cell</Label>
                      <Input value={cell} onChange={(e) => setCell(e.target.value)} placeholder="Cell" className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs">Village</Label>
                      <Input value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Village" className="h-9" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Location</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onEnablePickMode}>
                        <MapPin className="h-3 w-3" /> Pick on Map
                      </Button>
                      {pickedLocation ? (
                        <span className="text-xs text-muted-foreground">
                          {pickedLocation.lat.toFixed(4)}, {pickedLocation.lon.toFixed(4)}
                          {buildFullAddressLabel({
                            address: pickedLocation.address,
                            province: pickedLocation.province,
                            district: pickedLocation.district,
                            sector: pickedLocation.sector,
                            cell: pickedLocation.cell,
                            village: pickedLocation.village,
                          })
                            ? ` — ${buildFullAddressLabel({
                                address: pickedLocation.address,
                                province: pickedLocation.province,
                                district: pickedLocation.district,
                                sector: pickedLocation.sector,
                                cell: pickedLocation.cell,
                                village: pickedLocation.village,
                              })}`
                            : ''}
                        </span>
                      ) : isEdit ? (
                        <span className="text-xs text-muted-foreground">
                          {incidentToEdit!.location.lat.toFixed(4)}, {incidentToEdit!.location.lon.toFixed(4)}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Address (optional)"
                      className="h-9 mt-1.5 text-xs"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="witness" className="w-full overflow-hidden rounded-xl border bg-card">
              <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
                <span className="text-[13px] font-semibold">Witness</span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} placeholder="Name" className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input value={witnessPhone} onChange={(e) => setWitnessPhone(e.target.value)} placeholder="Phone" className="h-9" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input value={witnessEmail} onChange={(e) => setWitnessEmail(e.target.value)} placeholder="witness@email.com" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      value={witnessNotes}
                      onChange={(e) => setWitnessNotes(e.target.value)}
                      placeholder="Optional notes"
                      rows={2}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
            </Accordion>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={
              !title.trim() ||
              !description.trim() ||
              createMutation.isPending ||
              updateMutation.isPending
            }
          >
            {isEdit ? 'Save changes' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
