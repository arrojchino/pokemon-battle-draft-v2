/**
 * Trainer model picker (My Profile): one card per model in `TRAINER_MODELS`, each an offline-rendered portrait
 * (`public/trainers/<id>.png`, made by `qa/trainer.html?portraits`) with the player's colour laid over the outfit
 * through the portrait's outfit mask (`<id>-mask.png`, CSS mask + multiply). No WebGL here: the World owns the
 * only renderer, and the chosen model shows on the player's own trainer in the plaza.
 *
 * A radio group: arrow keys move the choice, Home/End jump to the ends; `onChange` fires with the new id.
 */
import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useT, type MessageKey } from '../i18n/index.js';
import { TRAINER_MODELS, trainerModel, type TrainerId } from '../../../shared/src/trainers.js';
import '../styles/trainer-picker.css';

export interface TrainerPickerProps {
  value: TrainerId;
  /** The player's outfit colour (CSS colour), shown on every portrait. */
  tint: string;
  onChange: (id: TrainerId) => void;
  className?: string;
}

/** Display names: the models' own names; the recoloured presenter is the classic trainer. */
const NAME: Record<TrainerId, MessageKey | string> = {
  classic: 'trainerPicker.classic', shibu: 'Shibu', vivi: 'Vivi', vita: 'Vita', hana: 'Hana', kai: 'Kai', kate: 'Kate', kyle: 'Kyle',
};

export function TrainerPicker({ value, tint, onChange, className }: TrainerPickerProps) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = import.meta.env.BASE_URL;
  const name = (id: TrainerId) => { const n = NAME[id] ?? id; return n.startsWith('trainerPicker.') ? t(n as MessageKey) : n; };
  const ids = TRAINER_MODELS.map(m => m.id as TrainerId);
  const cur = Math.max(0, ids.indexOf(value));

  const onKey = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % ids.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(ids[next]);
    refs.current[next]?.focus();
  };

  const sel = trainerModel(value);
  return (
    <div className={`trainer-picker${className ? ` ${className}` : ''}`} style={{ '--tp-tint': tint } as CSSProperties}>
      <div className="tp-grid scroller" role="radiogroup" aria-label={t('trainerPicker.label')} onKeyDown={onKey}>
        {ids.map((id, i) => {
          const on = i === cur;
          return (
            <button
              key={id} ref={el => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              className={`tp-card${on ? ' on' : ''}`} onClick={() => onChange(id)} title={name(id)}
            >
              <span className="tp-shot">
                <img className="tp-img" src={`${base}trainers/${id}.png`} alt="" loading="lazy" draggable={false} />
                <span className="tp-tint" style={{ WebkitMaskImage: `url(${base}trainers/${id}-mask.png)`, maskImage: `url(${base}trainers/${id}-mask.png)` }} />
              </span>
              <span className="tp-name">{name(id)}</span>
            </button>
          );
        })}
      </div>
      <p className="tp-credit">{t('trainerPicker.credit', { credit: sel.credit, license: sel.license })}</p>
    </div>
  );
}

export default TrainerPicker;
