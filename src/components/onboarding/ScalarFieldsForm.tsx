import type { CompanyCalibrationInput } from "../../services/calibrationService";

export type ScalarField = {
  key: keyof CompanyCalibrationInput;
  label: string;
  unit?: string;
  placeholder?: string;
};

// Controlled grid of scalar calibration inputs. Binds to a raw string map so
// mid-typing values (e.g. "12.") aren't clobbered; the wizard converts to
// numbers on save (saveCalibrationForCompany upserts the whole row).
export default function ScalarFieldsForm({
  fields,
  values,
  onChange,
  columns = 2,
}: {
  fields: ScalarField[];
  values: Record<string, string>;
  onChange: (key: string, raw: string) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className={`ob-grid ${columns === 3 ? "ob-grid-3" : ""}`}>
      {fields.map((f) => {
        const k = String(f.key);
        return (
          <div key={k}>
            <label className="ob-field-label">
              {f.label}
              {f.unit && <span className="ob-field-unit"> ({f.unit})</span>}
            </label>
            <input
              className="ob-input"
              inputMode="decimal"
              value={values[k] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => onChange(k, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
