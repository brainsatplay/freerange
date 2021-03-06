
// Originally released under the MIT license by neurobotics
// https://github.com/Neurobotics/jsEDF
// Implemented on-demand data reading

const flipBits = (n) => parseInt(n.toString(2).split('').map(bit => 1 - bit).join(''),2)

function arrayToAscii(array, start, length) {
    return array.slice(start, start + length).reduce((a, b) => {
        return a + String.fromCharCode(b)
    }, '').trim();
}

let globalBytes = []

export default class EDF {
    constructor(uint8array) {

        this.channelsOffset = 256
        globalBytes = uint8array;
        this.duration = this.data_record_duration * this.data_records;
        this.bytes_per_sample = this.header == "0" ? 2 : 3;
        this.has_annotations = false;
        const n = this.channelCount;
        this.annotation_bytes = 0;
        if (n > 0){
            this.sampling_rate = this.channels[0].num_samples * this.data_record_duration;
            this.sample_size = 0;
        }

        if (this.has_annotations) this.sample_size = (n - 1) * 2 * this.sampling_rate + 60 * 2;
        else this.sample_size = (n) * 2 * this.sampling_rate;

        this.samples_in_one_data_record = this.sampling_rate * this.data_record_duration;
    }

    get bytes() {
        return globalBytes // Don't save as enumerable on the object
    }

    get headerOffset() {
        if (!this._headerOffset) this._headerOffset = this.channelCount * (16 + 2 * (80) + 6 * (8) + 1 * (32))
        return this._headerOffset
    }

    get header() {
        if (!this._header) this._header = arrayToAscii(globalBytes, 0, 8);
        return this._header
    }

    get patient() {
        if (!this._patient) this._patient = arrayToAscii(globalBytes, 8, 80);
        return this._patient
    }

    get info() {
        if (!this._info) this._info = arrayToAscii(globalBytes, 88, 80);
        return this._info
    }

    get date() {
        if (!this._date) this._date = arrayToAscii(globalBytes, 88, 80);
        return this._date
    }
    get time() {
        if (!this._time) this._time = arrayToAscii(globalBytes, 176, 8);
        return this._time
    }
    get header_bytes() {
        if (!this._header_bytes) this._header_bytes = arrayToAscii(globalBytes, 184, 8);
        return this._header_bytes
    }

    get data_format() {
        if (!this._data_format) this._data_format = arrayToAscii(globalBytes, 192, 44);
        return this._data_format
    }
    get data_records() {
        if (!this._data_records) this._data_records = parseInt(arrayToAscii(globalBytes, 236, 8));
        return this._data_records
    }

    get data_record_duration() {
        if (!this._data_record_duration) this._data_record_duration = parseFloat(arrayToAscii(globalBytes, 244, 8));
        return this._data_record_duration
    }

    get channelCount() {
        if (!this._channelCount) this._channelCount = parseInt(arrayToAscii(globalBytes, 252, 4));
        return this._channelCount
    }

    get perChannelOffset() {
        return this.samples_in_one_data_record * this.bytes_per_sample
    }

    get channels() {

        let pos = this.channelsOffset
        if (!this._channels) {
            this._channels = [];
            const n = this.channelCount
            for (var i = 0; i < n; i++) {
                var channel = new Object();
                channel.label = arrayToAscii(globalBytes, pos, 16); pos += 16;
                if (channel.label.indexOf("DF Annotations") > 0) this.has_annotations = true;
                this._channels.push(channel);
            }

            // Channel Metadata
            for (var i = 0; i < n; i++) {
                this._channels[i].transducer = arrayToAscii(globalBytes, pos, 80);
                pos += 80;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].dimensions = arrayToAscii(globalBytes, pos, 8);
                pos += 8;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].phys_min = parseInt(arrayToAscii(globalBytes, pos, 8));
                pos += 8;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].phys_max = parseInt(arrayToAscii(globalBytes, pos, 8));
                pos += 8;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].digital_min = parseInt(arrayToAscii(globalBytes, pos, 8));
                pos += 8;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].digital_max = parseInt(arrayToAscii(globalBytes, pos, 8));
                pos += 8;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].prefilters = arrayToAscii(globalBytes, pos, 80);
                pos += 80;
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].num_samples = parseInt(arrayToAscii(globalBytes, pos, 8)); pos += 8;
                if (this.has_annotations && i == this.channelCount - 1) this.annotation_bytes = this._channels[i].num_samples * 2; // Account for annotation channel
            }

            for (var i = 0; i < n; i++) {
                this._channels[i].k = (this._channels[i].phys_max - this._channels[i].phys_min) / (this._channels[i].digital_max - this._channels[i].digital_min);
                pos += 32; // TODO: Understand why this is happening
            }

            // Define Data Getter
            for (var i = 0; i < n; i++) {
                const o = {i, data: null}
                Object.defineProperty(this._channels[i], 'data', {
                    enumerable: true,
                    get: () => {
                        if (!o.data) o.data = this.getChannelData(o.i)
                        return o.data
                    },
                    set: (data) => {
                        o.data = data // TODO: encode as buffer
                    }
                });
            }
        }

        return this._channels
    }

    getChannelData = (i = 0) => {

        let realChannelCount = (this.has_annotations) ? this.channelCount - 1 : this.channelCount
        let pos = this.headerOffset + i * (this.perChannelOffset) // First run position
        var koef = this.channels[i].k;

        const data = [] // Concatenate data records together
        for (var j = 0; j < this.data_records; j++) {

            for (var k = 0; k < this.samples_in_one_data_record; k++) {

                let val;
                if (this.bytes_per_sample == 2) {
                    var b1 = globalBytes[pos]; pos++;
                    var b2 = globalBytes[pos]; pos++;

                    val = (b2 << 8) + b1;
                    if (b2 >> 7 == 1) val = -flipBits(val)-1;	
                } else if (this.bytes_per_sample == 3) {
                    var b1 = globalBytes[pos]; pos++;
                    var b2 = globalBytes[pos]; pos++;
                    var b3 = globalBytes[pos]; pos++;
                    val = (b3 << 16) + (b2 << 8) + b1;
                    if (b3 >> 7 == 1) val = -flipBits(val)-1;
                }
                data.push(val * koef);

            }

            pos += this.annotation_bytes + (this.perChannelOffset * realChannelCount)// Account for difference in annotation bytes
        }

        return data
    }

    get annotations() {
        if (!this._annotations) {
            this._annotations = ''
            let offset = this.headerOffset
            let realChannelCount = (this.has_annotations) ? this.channelCount - 1 : this.channelCount
            for (var j = 0; j < this.data_records; j++) {
                offset += realChannelCount * this.perChannelOffset // Go to the end of the channels
                this._annotations += arrayToAscii(globalBytes, offset, this.annotation_bytes)
                offset += this.annotation_bytes // Add the annotation bytes to the offset
            }
        } else return this._annotations
    }
}