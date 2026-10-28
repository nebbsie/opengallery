import { Directive, computed, input } from '@angular/core';
import { hlm } from '@spartan-ng/brain/core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { ClassValue } from 'clsx';

export const cardVariants = cva('glass-strong text-card-foreground flex flex-col gap-6 rounded-3xl py-6', {
	variants: {},
	defaultVariants: {},
});
export type CardVariants = VariantProps<typeof cardVariants>;

@Directive({
	selector: '[hlmCard]',
	host: {
		'[class]': '_computedClass()',
	},
})
export class HlmCard {
	public readonly userClass = input<ClassValue>('', { alias: 'class' });
	protected _computedClass = computed(() => hlm(cardVariants(), this.userClass()));
}
