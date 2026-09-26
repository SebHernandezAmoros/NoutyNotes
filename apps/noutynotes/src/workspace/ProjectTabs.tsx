import type { WorkspaceSummary } from '@noutynotes/application';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';

/** Alto de cada pestaña vertical; el nombre se recorta si no cabe (el nombre accesible es completo). */
const TAB_LENGTH = 184;
const RAIL_WIDTH = 48;

interface ProjectTabsProps {
  readonly projects: readonly WorkspaceSummary[];
  readonly currentId: string | undefined;
  /** Cambia de proyecto; quien llama guarda antes el borrador pendiente. */
  readonly onOpen: (id: string) => void;
}

const numbered = (index: number) => String(index + 1).padStart(2, '0');

/**
 * Pestañas verticales de proyectos a la derecha (ADR 0016). «Proyecto» es el nombre visual del
 * workspace: son los espacios reales de la sesión o de la carpeta abierta.
 */
export function ProjectRail({ projects, currentId, onOpen }: ProjectTabsProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <ScrollView
      testID="project-tabs"
      accessibilityLabel="Proyectos"
      style={[styles.rail, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}
      contentContainerStyle={styles.railContent}
    >
      {projects.map((project, index) => (
        <RailTab key={project.id} number={numbered(index)} name={project.name} active={project.id === currentId} onPress={() => onOpen(project.id)} />
      ))}
    </ScrollView>
  );
}

function RailTab({ number, name, active, onPress }: { readonly number: string; readonly name: string; readonly active: boolean; readonly onPress: () => void }) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const ink = active ? colors.brandText : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `${name}, proyecto actual` : `Ir al proyecto ${name}`}
      accessibilityState={{ selected: active }}
      {...(Platform.OS === 'web' ? { 'aria-pressed': active } : {})}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.tab, {
        backgroundColor: active ? colors.brand : colors.surface,
        borderColor: focused ? colors.selection : colors.border,
        borderLeftWidth: active ? 0 : 2,
      }]}
    >
      {/* El texto se escribe en horizontal y se gira: la caja táctil sigue siendo la de la pestaña. */}
      <View style={styles.turned}>
        <Text style={[styles.number, { color: ink }]}>{number}</Text>
        <Text numberOfLines={1} style={[styles.name, { color: ink }]}>{name.toUpperCase()}</Text>
      </View>
    </Pressable>
  );
}

/** Móvil: la misma lista en una hoja, abierta desde «Proyectos» en la cabecera. */
export function ProjectSheet({ projects, currentId, onOpen, visible, onClose }: ProjectTabsProps & { readonly visible: boolean; readonly onClose: () => void }) {
  return (
    <Dialog visible={visible} title="Proyectos" compact onClose={onClose} testID="project-sheet">
      <View style={styles.list}>
        {projects.map((project, index) => {
          const active = project.id === currentId;
          return (
            <ActionButton
              key={project.id}
              label={`${numbered(index)}  ${project.name}${active ? '  · actual' : ''}`}
              accessibilityLabel={active ? `${project.name}, proyecto actual` : `Ir al proyecto ${project.name}`}
              pressed={active}
              onPress={() => { onClose(); if (!active) onOpen(project.id); }}
            />
          );
        })}
      </View>
    </Dialog>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  rail: { width: RAIL_WIDTH + 8, flexGrow: 0, borderLeftWidth: 2 },
  railContent: { paddingVertical: 12, paddingLeft: 8, gap: 6 },
  tab: { width: RAIL_WIDTH, height: TAB_LENGTH, borderWidth: 2, overflow: 'hidden' },
  turned: {
    position: 'absolute', width: TAB_LENGTH - 4, height: RAIL_WIDTH - 4,
    left: (RAIL_WIDTH - TAB_LENGTH) / 2, top: (TAB_LENGTH - RAIL_WIDTH) / 2,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10,
    transform: [{ rotate: '90deg' }],
  },
  number: { fontFamily: mono, fontSize: 12, fontWeight: '800' },
  name: { flexShrink: 1, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  list: { gap: 8 },
});
