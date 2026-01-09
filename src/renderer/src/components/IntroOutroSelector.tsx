interface IntroOutroConfig {
  introImagePath: string;
  outroImagePath: string;
}

interface Props {
  config: IntroOutroConfig;
  onChange: (config: IntroOutroConfig) => void;
}

export default function IntroOutroSelector({ config, onChange }: Props) {
  return (
    <div style={{ padding: '10px', border: '1px solid #333', borderRadius: '4px', marginBottom: '10px' }}>
      <h4 style={{ marginTop: 0 }}>Intro/Outro Configuration</h4>
      <div style={{ marginBottom: '10px' }}>
        <label>
          Intro Image:
          <input
            type="text"
            value={config.introImagePath}
            onChange={(e) => onChange({ ...config, introImagePath: e.target.value })}
            style={{ width: '100%', padding: '5px', marginTop: '5px' }}
          />
        </label>
      </div>
      <div>
        <label>
          Outro Image:
          <input
            type="text"
            value={config.outroImagePath}
            onChange={(e) => onChange({ ...config, outroImagePath: e.target.value })}
            style={{ width: '100%', padding: '5px', marginTop: '5px' }}
          />
        </label>
      </div>
    </div>
  );
}
