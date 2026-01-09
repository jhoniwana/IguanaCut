// Stub component - IntroOutroSelector
interface IntroOutroConfig {
  introImagePath: string;
  introDuration: number;
  outroImagePath: string;
  outroDuration: number;
}

interface Props {
  config: IntroOutroConfig;
  onChange: (config: IntroOutroConfig) => void;
}

export default function IntroOutroSelector({ config, onChange }: Props) {
  return (
    <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
      <p>Intro/Outro feature coming soon</p>
    </div>
  );
}
