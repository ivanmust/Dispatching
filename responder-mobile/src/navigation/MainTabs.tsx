import React, { useCallback, useEffect, useState } from "react";
import { DeviceEventEmitter, View, useWindowDimensions } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ResponderHomeScreen } from "../screens/ResponderHomeScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { MessagesScreen } from "../screens/MessagesScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { api } from "../lib/api";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { VideoRequestOverlay } from "../components/VideoRequestOverlay";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabBarIconWrap({
  focused,
  color,
  name,
  themeTabHighlight: highlight,
  size,
  iconSize,
}: {
  focused: boolean;
  color: string;
  name: React.ComponentProps<typeof Ionicons>["name"];
  themeTabHighlight: string;
  size: number;
  iconSize: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? highlight : "transparent",
      }}
    >
      <Ionicons name={name} color={color} size={iconSize} />
    </View>
  );
}

function tabBadgeValue(n: number): string | undefined {
  const safe = Number(n);
  if (!Number.isFinite(safe) || safe <= 0) return undefined;
  if (safe > 99) return "99+";
  return String(Math.trunc(safe));
}

function countOpenWorkload(incidents: Awaited<ReturnType<typeof api.getAssignedIncidents>>): number {
  return incidents.filter((i) => {
    const s = String(i.status).toUpperCase();
    return !["RESOLVED", "CLOSED"].includes(s);
  }).length;
}

export function MainTabs() {
  const [settingsAlertsBadge, setSettingsAlertsBadge] = useState<number>(0);
  const [chatsBadge, setChatsBadge] = useState<number>(0);
  const [tasksBadge, setTasksBadge] = useState<number>(0);
  const { socket } = useSocketMobile();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { theme } = useAppTheme();
  const compact = width < 390;
  const tablet = width >= 768;

  const refreshSettingsAlertsBadge = useCallback(async () => {
    try {
      const unread = await api.getUnreadNotificationCount();
      setSettingsAlertsBadge(unread.count || 0);
    } catch {
      // ignore
    }
  }, []);

  const refreshChatsBadge = useCallback(async () => {
    try {
      const contacts = await api.listDmContacts();
      const count = contacts.reduce((sum, c) => sum + Number(c.unreadCount ?? 0), 0);
      setChatsBadge(count);
    } catch {
      // ignore
    }
  }, []);

  const refreshTasksBadge = useCallback(async () => {
    try {
      const rows = await api.getAssignedIncidents();
      setTasksBadge(countOpenWorkload(rows));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshSettingsAlertsBadge();
    void refreshChatsBadge();
    void refreshTasksBadge();
    const id = setInterval(() => {
      void refreshSettingsAlertsBadge();
      void refreshChatsBadge();
      void refreshTasksBadge();
    }, 15000);
    return () => clearInterval(id);
  }, [refreshSettingsAlertsBadge, refreshChatsBadge, refreshTasksBadge]);

  useEffect(() => {
    if (!socket) return;
    const onRefreshAlerts = () => void refreshSettingsAlertsBadge();
    const onDm = () => void refreshChatsBadge();
    const onIncident = () => void refreshTasksBadge();
    socket.on("notification:new", onRefreshAlerts);
    socket.on("dm:newMessage", onDm);
    socket.on("incident:assigned", onIncident);
    socket.on("incident:statusChange", onIncident);
    socket.on("incident:statusUpdate", onIncident);
    socket.on("incident:updated", onIncident);
    socket.on("incident:unassigned", onIncident);
    return () => {
      socket.off("notification:new", onRefreshAlerts);
      socket.off("dm:newMessage", onDm);
      socket.off("incident:assigned", onIncident);
      socket.off("incident:statusChange", onIncident);
      socket.off("incident:statusUpdate", onIncident);
      socket.off("incident:updated", onIncident);
      socket.off("incident:unassigned", onIncident);
    };
  }, [socket, refreshSettingsAlertsBadge, refreshChatsBadge, refreshTasksBadge]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("dm:badgeRefresh", () => void refreshChatsBadge());
    return () => sub.remove();
  }, [refreshChatsBadge]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("tasks:badgeRefresh", () => void refreshTasksBadge());
    return () => sub.remove();
  }, [refreshTasksBadge]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("settings:alertsBadgeRefresh", () => void refreshSettingsAlertsBadge());
    return () => sub.remove();
  }, [refreshSettingsAlertsBadge]);

  const badgeStyle = {
    backgroundColor: theme.color.danger,
    color: theme.color.white,
    fontSize: tablet ? 11 : 10,
    fontWeight: "700" as const,
    minWidth: tablet ? 22 : 18,
    height: tablet ? 22 : 18,
    lineHeight: tablet ? 22 : 18,
    borderRadius: tablet ? 11 : 9,
    top: -2,
    right: tablet ? -6 : -8,
    borderWidth: 2,
    borderColor: theme.color.badgeBorder,
  };

  const tabBarBottomInset = Math.max(insets.bottom, tablet ? 14 : 10);
  const tabBarHeight = (tablet ? 72 : compact ? 58 : 62) + tabBarBottomInset;
  const iconWrapSize = tablet ? 54 : compact ? 42 : 48;
  const iconSize = tablet ? 26 : compact ? 22 : 24;
  const horizontalInset = tablet ? Math.max(18, Math.floor((width - 860) / 2)) : 0;

  const highlight = theme.color.primarySoft;

  return (
    <>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarLabelStyle: { fontSize: tablet ? 12 : compact ? 10 : 11, fontWeight: "700", marginBottom: compact ? 1 : 2 },
          tabBarActiveTintColor: theme.color.primary2,
          tabBarInactiveTintColor: theme.color.textMuted,
          tabBarStyle: {
            position: "absolute",
            left: horizontalInset,
            right: horizontalInset,
            bottom: 0,
            backgroundColor: theme.color.tabBarBg,
            borderTopWidth: 0,
            borderTopLeftRadius: theme.radius.sheetTop,
            borderTopRightRadius: theme.radius.sheetTop,
            height: tabBarHeight,
            paddingBottom: tabBarBottomInset,
            paddingTop: tablet ? 8 : 6,
            elevation: 18,
            shadowColor: "#0f172a",
            shadowOpacity: 0.12,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -10 },
          },
          tabBarItemStyle: { paddingTop: tablet ? 4 : 2 },
        }}
      >
        <Tab.Screen
          name="Task"
          component={ResponderHomeScreen}
          options={{
            tabBarLabel: "Task",
            tabBarIcon: ({ color, focused }) => (
              <TabBarIconWrap
                focused={focused}
                color={color}
                name="clipboard-outline"
                themeTabHighlight={highlight}
                size={iconWrapSize}
                iconSize={iconSize}
              />
            ),
            tabBarBadge: tabBadgeValue(tasksBadge),
            tabBarBadgeStyle: badgeStyle,
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              const state = navigation.getState();
              const activeName = state.routes[state.index]?.name;
              if (activeName === "Task") {
                e.preventDefault();
                DeviceEventEmitter.emit("tasks:toggleIncidentList");
              }
            },
            focus: () => {
              void refreshTasksBadge();
            },
          })}
        />
        <Tab.Screen
          name="Chats"
          component={MessagesScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabBarIconWrap
                focused={focused}
                color={color}
                name="chatbubble-outline"
                themeTabHighlight={highlight}
                size={iconWrapSize}
                iconSize={iconSize}
              />
            ),
            tabBarBadge: tabBadgeValue(chatsBadge),
            tabBarBadgeStyle: badgeStyle,
          }}
          listeners={() => ({
            focus: () => {
              void refreshChatsBadge();
            },
          })}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabBarIconWrap
                focused={focused}
                color={color}
                name="time-outline"
                themeTabHighlight={highlight}
                size={iconWrapSize}
                iconSize={iconSize}
              />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabBarIconWrap
                focused={focused}
                color={color}
                name="settings-outline"
                themeTabHighlight={highlight}
                size={iconWrapSize}
                iconSize={iconSize}
              />
            ),
            tabBarBadge: tabBadgeValue(settingsAlertsBadge),
            tabBarBadgeStyle: badgeStyle,
          }}
          listeners={() => ({
            focus: () => {
              void refreshSettingsAlertsBadge();
            },
          })}
        />
      </Tab.Navigator>
      <VideoRequestOverlay />
    </>
  );
}
