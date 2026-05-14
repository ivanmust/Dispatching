import { StatusBar } from "expo-status-bar";
import React, { useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-screens";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthProviderMobile, useAuthMobile } from "./src/contexts/AuthContextMobile";
import { SocketProviderMobile } from "./src/contexts/SocketContextMobile";
import { ThemePreferenceProvider, useAppTheme } from "./src/contexts/ThemePreferenceContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MainTabs } from "./src/navigation/MainTabs";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import type { RootStackParamList } from "./src/navigation/types";

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { isAuthenticated, loading } = useAuthMobile();
  const { theme, isDark } = useAppTheme();

  if (loading) {
    return <StatusBar style={isDark ? "light" : "dark"} />;
  }

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen
              name="IncidentMap"
              getComponent={() => require("./src/screens/ResponderIncidentMapScreen").default}
            />
            <Stack.Screen
              name="TripNavigation"
              getComponent={() => require("./src/screens/TripNavigationScreen").default}
            />
            <Stack.Screen name="Alerts" component={NotificationsScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </>
  );
}

function ThemedNavigation() {
  const { theme, isDark } = useAppTheme();
  const navigationTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: theme.color.primary2,
        background: theme.color.screenMuted,
        card: theme.color.tabBarBg,
        text: theme.color.text,
        border: theme.color.border,
        notification: theme.color.danger,
      },
    }),
    [isDark, theme],
  );

  return (
    <NavigationContainer theme={navigationTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProviderMobile>
        <SocketProviderMobile>
          <ThemePreferenceProvider>
            <ThemedNavigation />
          </ThemePreferenceProvider>
        </SocketProviderMobile>
      </AuthProviderMobile>
    </SafeAreaProvider>
  );
}
