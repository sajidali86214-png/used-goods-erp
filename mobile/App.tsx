import { SafeAreaView, ScrollView, StyleSheet, Text } from "react-native";

/**
 * Status: SKELETON. This screen does not call the backend API yet.
 * Real navigation (Dashboard/Stock/Purchases/Orders/Finance/Reports/Settings)
 * is specified in ../docs/04-screen-map.md and not yet built.
 */
export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Used Goods ERP</Text>
        <Text style={styles.body}>
          This is an unimplemented skeleton. See docs/04-screen-map.md and
          docs/01-implementation-plan.md in the repo root for the real plan and current stage.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 12 },
  body: { fontSize: 15, color: "#333" },
});
