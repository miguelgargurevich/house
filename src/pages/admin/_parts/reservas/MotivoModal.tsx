import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Modal, Textarea } from '../../../../ui';

export const TOPE_MOTIVO = 300;

interface Props {
  open: boolean;
  title: string;
  description: string;
  /** Rechazar exige el motivo; cancelar lo deja opcional. */
  obligatorio: boolean;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
}

/** Pide el motivo de un rechazo o de una cancelación (el vecino lo ve en su reserva). */
export function MotivoModal({ open, title, description, obligatorio, confirmLabel, onClose, onConfirm }: Props) {
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<{ motivo: string }>({ defaultValues: { motivo: '' } });
  useEffect(() => { if (open) reset({ motivo: '' }); }, [open, reset]);
  const largo = (watch('motivo') ?? '').length;
  const enviar = handleSubmit(async v => { await onConfirm(v.motivo.trim()); });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button variant="danger" loading={isSubmitting} onClick={enviar}>{confirmLabel}</Button></>}
    >
      <form onSubmit={enviar} noValidate>
        <Textarea
          label={obligatorio ? 'Motivo' : 'Motivo (opcional)'}
          rows={4}
          maxLength={TOPE_MOTIVO}
          hint={`Lo verá el vecino en su reserva. ${largo} / ${TOPE_MOTIVO}`}
          error={errors.motivo && 'Escribe el motivo'}
          {...register('motivo', { validate: v => !obligatorio || !!v.trim() })}
        />
      </form>
    </Modal>
  );
}
