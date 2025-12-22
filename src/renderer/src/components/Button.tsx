import { memo, forwardRef, ButtonHTMLAttributes, DetailedHTMLProps } from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const Button = memo(forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  children,
  variant = 'primary',
  size = 'medium',
  loading = false,
  icon,
  iconPosition = 'left',
  disabled,
  onClick,
  ...props
}, ref) => {
  return (
    <button
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${loading ? styles.loading : ''}`}
      disabled={disabled || loading}
      onClick={onClick}
      ref={ref}
      {...props}
    >
      {loading && (
        <div className={styles.spinner} />
      )}
      
      {icon && iconPosition === 'left' && (
        <span className={styles.iconLeft}>{icon}</span>
      )}
      
      {children && (
        <span className={styles.text}>{children}</span>
      )}
      
      {icon && iconPosition === 'right' && (
        <span className={styles.iconRight}>{icon}</span>
      )}
    </button>
  );
}));

Button.displayName = 'Button';

export default Button;