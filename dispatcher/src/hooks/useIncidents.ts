import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { api, dedupeIncidentsByIdPreferNewest } from '@/lib/api';
import type { IncidentStatus, IncidentCategory, IncidentPriority, Incident } from '@/types/incident';
import { toast } from '@/hooks/use-toast';

export type IncidentFilters = {
  status?: string;
  unit?: 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE';
  limit?: number;
  offset?: number;
};

export function useIncidents(filters?: IncidentFilters): UseQueryResult<Incident[], Error> {
  const [knownIncidentIds, setKnownIncidentIds] = useState<string[]>([]);

  const params = filters
    ? {
        status: filters.status && filters.status !== 'ALL' ? filters.status : undefined,
        unit: filters.unit && filters.unit !== 'ALL' ? (filters.unit as 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE') : undefined,
        limit: filters.limit,
        offset: filters.offset,
      }
    : undefined;

  return useQuery<Incident[], Error>({
    queryKey: ['incidents', params ?? 'all'] as const,
    queryFn: () => api.getIncidents(params),
    select: (rows) => dedupeIncidentsByIdPreferNewest(rows),
    refetchInterval: 30000,
    onSuccess: incidents => {
      setKnownIncidentIds(incidents.map(i => i.id));
    },
  });
}

export function useResponders(options?: {
  unit?: 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE';
}) {
  const unit = options?.unit;
  return useQuery({
    queryKey: ['responders', unit ?? 'all'],
    queryFn: () => api.getResponders(unit ? { unit } : undefined),
  });
}

export function useIncidentHistory(incidentId: string | undefined) {
  return useQuery({
    queryKey: ['incident-history', incidentId],
    queryFn: () => api.getIncidentHistory(incidentId!),
    enabled: !!incidentId,
  });
}

export function useChatMessages(incidentId: string | undefined) {
  return useQuery({
    queryKey: ['chat', incidentId],
    queryFn: () => api.getChatMessages(incidentId!),
    enabled: !!incidentId,
    refetchInterval: 5000,
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Incident, 'id' | 'createdAt' | 'updatedAt'>) => api.createIncident(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Incident> }) => api.updateIncident(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useAssignResponder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      incidentId,
      responderId,
      unitOverride,
      reason,
    }: {
      incidentId: string;
      responderId: string;
      unitOverride?: boolean;
      reason?: string;
    }) => api.assignResponder(incidentId, responderId, { unitOverride, reason }),
    onSuccess: (_, { incidentId }) => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-history', incidentId] });
    },
  });
}

export function useReassignResponder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      incidentId,
      responderId,
      unitOverride,
      reason,
    }: {
      incidentId: string;
      responderId: string;
      unitOverride?: boolean;
      reason?: string;
    }) => api.reassignResponder(incidentId, responderId, { unitOverride, reason }),
    onSuccess: (_, { incidentId }) => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-history', incidentId] });
    },
  });
}

export function useUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ incidentId, status }: { incidentId: string; status: IncidentStatus }) =>
      api.updateStatus(incidentId, status),
    onSuccess: (_, { incidentId }) => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-history', incidentId] });
    },
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ incidentId, text, attachmentUrl, attachmentType }: { incidentId: string; text: string; attachmentUrl?: string; attachmentType?: 'image' | 'video' }) =>
      api.sendChatMessage(incidentId, text, { attachmentUrl, attachmentType }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['chat', vars.incidentId] }),
  });
}
