import { singleton } from 'tsyringe';
import { Logger } from '../shared/index';

interface TimingEntry {
    operation: string;
    startTime: number;
    endTime?: number;
    duration?: number;
}

@singleton()
export class TimingService {
    private timings: TimingEntry[] = [];
    private logger = new Logger('Timing');

    startTiming(operation: string): void {
        this.timings.push({
            operation,
            startTime: Date.now()
        });
    }

    endTiming(operation: string): void {
        const entry = this.timings.find(t => t.operation === operation && !t.endTime);
        if (entry) {
            entry.endTime = Date.now();
            entry.duration = entry.endTime - entry.startTime;
        }
    }

    logTimings(): void {
        const tableData = this.timings
            .filter(t => t.duration !== undefined)
            .map(({ operation, duration }) => ({
                Operation: operation,
                'Duration (ms)': duration
            }));

        if (tableData.length > 0) {
            console.log('\nOperation Timings:');
            console.table(tableData);
        }

        // Clear timings after logging
        this.timings = [];
    }
}