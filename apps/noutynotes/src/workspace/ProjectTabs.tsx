import type { WorkspaceSummary } from '@noutynotes/application';
import { StyleSheet, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';

interface ProjectTabsProps {
  readonly projects: readonly WorkspaceSummary[];
  readonly currentId: string | undefined;
  /** Cambia de proyecto; quien llama guarda antes el borrador pendiente. */
  readonly onOpen: (id: string) => void;
}

const numbered = (index: number) => String(index + 1).padStart(2, '0');

/** Selector de proyectos abierto desde «Proyectos» en la cabecera, en cualquier ancho de escritorio (ADR 0048). */
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

const styles = StyleSheet.create({
  list: { gap: 8 },
});
