import { useState } from 'react';
import { Button, Modal } from '../../../../ui';
import { ImagenEditable } from '../condominio/ImagenEditable';

/** Foto del contómetro de un departamento (la lectura ya debe estar guardada). */
export function FotoContometroModal({ reciboId, unidadId, codigo, tieneFoto, onClose, onCambio }: { reciboId: number; unidadId: number; codigo: string; tieneFoto: boolean; onClose: () => void; onCambio: () => void }) {
  const ruta = `/api/recibos/${reciboId}/agua/${unidadId}/foto`;
  const [version, setVersion] = useState(() => Date.now());
  const [hay, setHay] = useState(tieneFoto);
  return (
    <Modal open onClose={onClose} title="Foto del contómetro" description={`Departamento ${codigo}`} footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      <ImagenEditable
        titulo="Foto del contómetro"
        ayuda="Sale en el recibo del departamento y la ve el vecino. JPG, PNG o WebP, hasta 2 MB."
        url={hay ? `${ruta}?v=${version}` : null}
        ruta={ruta}
        onCambio={h => { setHay(h); setVersion(Date.now()); onCambio(); }}
      />
    </Modal>
  );
}
