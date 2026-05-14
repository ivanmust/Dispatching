import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Height covered by the bottom tab bar in `MainTabs` (`position: "absolute"`).
 * Use for padding content/composers above the tab bar. Only valid inside the tab navigator.
 */
export function useTabBarOverlapReserve(): number {
  const measured = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const fallback = 62 + Math.max(insets.bottom, 10);
  return measured > 0 ? measured : fallback;
}
