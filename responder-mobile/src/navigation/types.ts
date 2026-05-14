import type { NavigatorScreenParams } from "@react-navigation/native";

export type MainTabParamList = {
  Task: { openIncidentId?: string } | undefined;
  Chats: undefined;
  History: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  IncidentMap: { incidentId?: string; lat?: number; lon?: number; title?: string } | undefined;
  TripNavigation: { incidentId?: string; lat?: number; lon?: number; title?: string } | undefined;
  Alerts: undefined;
};
