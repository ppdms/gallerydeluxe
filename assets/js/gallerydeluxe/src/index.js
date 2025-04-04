'use strict';

import * as params from '@params';
import { Pig } from './pig';
import { newSwiper } from './helpers';

var debug = 0 ? console.log.bind(console, '[gallery-deluxe]') : function () {};

let GalleryDeluxe = {
	init: async function () {
		// One gallery per page (for now).
		const galleryId = 'gallerydeluxe';
		const dataAttributeName = 'data-gd-image-data-url';
		const container = document.getElementById(galleryId);
		if (!container) {
			throw new Error(`No element with id ${galleryId} found.`);
		}
		const dataUrl = container.getAttribute(dataAttributeName);
		if (!dataUrl) {
			throw new Error(`No ${dataAttributeName} attribute found.`);
		}

		// The image opened in the lightbox.
		let activeImage;
		let exifTimeoutId;

		// Lightbox setup.
		const modal = document.getElementById('gd-modal');
		const modalClose = modal.querySelector('#gd-modal-close');

		// Add new button for downloading original image
		const downloadOriginalButton = document.createElement('button');
		downloadOriginalButton.id = 'gd-modal-download-original';
		downloadOriginalButton.innerHTML = '↓'; // Downward arrow
		downloadOriginalButton.title = 'Download original image';
		downloadOriginalButton.classList.add('gd-modal-close');
		modalClose.parentNode.insertBefore(downloadOriginalButton, modalClose);

		const preventDefault = function (e) {
			// For iphone.
			e.preventDefault();
		};

		let imageWrapper = document.createElement('div');
		imageWrapper.classList.add('gd-modal-content-wrapper');
		modal.insertBefore(imageWrapper, modal.firstChild);

		let isNavigatingThroughHistory = false;

		const closeModal = (e) => {
			if (e) {
				e.preventDefault();
			}

			imageWrapper.removeEventListener('touchmove', preventDefault);
			imageWrapper.removeEventListener('gesturestart', preventDefault);

			// Hide the modal.
			modal.style.display = 'none';
			// Enable scrolling.
			document.body.style.overflow = 'auto';

			if (!isNavigatingThroughHistory) {
				// Clear the 'image' parameter from the URL
				const url = new URL(window.location);
				url.searchParams.delete('image');
				history.pushState({}, '', url);
			}
		};

		modalClose.addEventListener('click', function () {
			closeModal();
		});

		const swipe = function (direction) {
			debug('swipe', direction);
			switch (direction) {
				case 'left':
					activeImage = activeImage.next;
					openActiveImage();
					break;
				case 'right':
					activeImage = activeImage.prev;
					openActiveImage();
					break;
				default:
					closeModal();
					break;
			}
		};

		// Add some basic swipe logic.
		newSwiper(imageWrapper, function (direction) {
			swipe(direction);
		});

		document.addEventListener('keydown', function (e) {
			switch (e.key) {
				case 'ArrowLeft':
					swipe('right');
					break;
				case 'ArrowRight':
					swipe('left');
					break;
				case 'Escape':
					closeModal(e);
					break;
			}
		});

		const openActiveImage = () => {
			if (!isNavigatingThroughHistory) {
				// Update the URL with only the image hash
				const imageHash = activeImage.name.replace('img/', '').replace('.jpeg', '');
				const imageUrl = new URL(window.location);
				imageUrl.searchParams.set('image', imageHash);
				history.pushState({imageHash: imageHash}, '', imageUrl);
			}

			imageWrapper.addEventListener('touchmove', preventDefault);
			imageWrapper.addEventListener('gesturestart', preventDefault);

			const classLoaded = 'gd-modal-loaded';
			const classThumbnail = 'gd-modal-thumbnail';

			// Prevent scrolling of the background.
			document.body.style.overflow = 'hidden';
			let oldEls = modal.querySelectorAll('.gd-modal-content');
			let oldElsRemoved = false;

			// Delay the removal of the old elements to make sure we
			// have a image on screen before we remove the old one,
			// even on slower connections.
			const removeOldEls = () => {
				if (oldElsRemoved) {
					return;
				}
				oldElsRemoved = true;
				oldEls.forEach((element) => {
					element.remove();
				});
			};

			if (activeImage) {
				let modal = document.getElementById('gd-modal');

				if (params.enable_exif) {
					if (exifTimeoutId) {
						clearTimeout(exifTimeoutId);
					}

					let exif = modal.querySelector('#gd-modal-exif');
					const onTimeOutClass = 'gd-modal-exif-ontimeout';

					let child = exif.lastElementChild;
					while (child) {
						exif.removeChild(child);
						child = exif.lastElementChild;
					}
					let dl = document.createElement('dl');
					exif.appendChild(dl);

					const addTag = (tag, value) => {
						let dt = document.createElement('dt');
						dt.innerText = tag;
						dl.appendChild(dt);
						let dd = document.createElement('dd');
						dd.innerText = value;
						dl.appendChild(dd);
					};

					let date = new Date(activeImage.exif.Date);
					var dateString = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
						.toISOString()
						.split('T')[0];
					var timeString = date.toTimeString().split(' ')[0].substr(0, 5);  // HH:MM
					addTag('Date', `${dateString} ${timeString}`);

					// Add ISO and focal length
					if (activeImage.exif.Tags.FocalLengthIn35mmFormat) {
						addTag('Focal Length (35mm)', activeImage.exif.Tags.FocalLengthIn35mmFormat+"mm");
					}
					if (activeImage.exif.Tags.ExposureTime) {
						addTag('Exposure Time', activeImage.exif.Tags.ExposureTime);
					}
					if (activeImage.exif.Tags.FNumber) {
						// Format F-number as f/X.X
						const [numerator, denominator] = activeImage.exif.Tags.FNumber.split('/').map(Number);
						const fNumber = denominator ? numerator / denominator : numerator;
						const formattedFNumber = `f/${fNumber.toFixed(1)}`;
						addTag('F-number', formattedFNumber);
					}
					if (activeImage.exif.Tags.ISO) {
						addTag('ISO', activeImage.exif.Tags.ISO);
					}

					exif.classList.remove(onTimeOutClass);

					// Add map if GPS coordinates are available
					if (activeImage.exif.Lat && activeImage.exif.Long) {
						let mapDiv = document.createElement('div');
						mapDiv.id = 'gd-modal-map';
						mapDiv.style.height = '200px';
						mapDiv.style.marginTop = '10px';
						exif.appendChild(mapDiv);

						let lat = activeImage.exif.Lat;
						let lon = activeImage.exif.Long;

						// Delay map initialization
						setTimeout(() => {
							// Initialize the map
							let map = L.map('gd-modal-map', {
								center: [lat, lon],
								zoom: 13,
								zoomControl: false
							});

							// Add OpenStreetMap tile layer
							let tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
								attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
							}).addTo(map);

							// Add a marker at the image location with a click event to open Google Maps
							let marker = L.marker([lat, lon]).addTo(map);
							marker.on('click', function(e) {
								e.originalEvent.stopPropagation(); // Prevent event from bubbling up
								window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
							});

							// Function to ensure map is fully loaded
							const ensureMapLoaded = () => {
								map.invalidateSize();
								if (!map.hasLayer(tileLayer) || !map.hasLayer(marker)) {
									map.removeLayer(tileLayer);
									map.removeLayer(marker);
									tileLayer.addTo(map);
									marker.addTo(map);
								}
								map.setView([lat, lon], 13);
							};

							// Call ensureMapLoaded multiple times
							for (let i = 0; i < 5; i++) {
								setTimeout(ensureMapLoaded, 100 * (i + 1));
							}

							// Additional check after a longer delay
							setTimeout(ensureMapLoaded, 2000);
						}, 100);
					}

					exifTimeoutId = setTimeout(() => {
						exif.classList.add(onTimeOutClass);
					}, 1200);
				}

				let thumbnail = new Image();
				thumbnail.classList.add('gd-modal-content');
				thumbnail.width = activeImage.width;
				thumbnail.height = activeImage.height;
				thumbnail.style.aspectRatio = activeImage.width / activeImage.height;

				const fullImage = thumbnail.cloneNode(false);

				thumbnail.classList.add(classThumbnail);

				fullImage.src = activeImage.full;
				thumbnail.src = activeImage['500'] || activeImage.full;

				thumbnail.onload = function () {
					if (thumbnail) {
						imageWrapper.appendChild(thumbnail);
						removeOldEls();
					}
				};

				fullImage.onload = function () {
					if (fullImage) {
						imageWrapper.appendChild(fullImage);
						fullImage.classList.add(classLoaded);
						if (thumbnail) {
							thumbnail.classList.add(classLoaded);
						}
						removeOldEls();
					}
				};

				modal.style.display = 'block';

				// Update download original button URL
				const imageHash = activeImage.name.replace('img/', '').replace('.jpeg', '');
				downloadOriginalButton.onclick = (e) => {
					e.preventDefault();
					window.open(`https://data.ppdms.gr/originals/${imageHash}.jpeg`, '_blank');
				};

				setTimeout(function () {
					removeOldEls();
				}, 1000);
			}

			setTimeout(function () {
				removeOldEls();
			}, 1000);
		};

		// Load the gallery.
		let images = await (await fetch(dataUrl)).json();

		if (params.shuffle) {
			// Shuffle them to make it more interesting.
			images = images
				.map((value) => ({ value, sort: Math.random() }))
				.sort((a, b) => a.sort - b.sort)
				.map(({ value }) => value);
		} else if (params.reverse) {
			images = images.reverse();
		}

		let imagesMap = new Map();
		let imageData = [];
		for (let i = 0; i < images.length; i++) {
			let image = images[i];
			image.prev = images[(i + images.length - 1) % images.length];
			image.next = images[(i + 1) % images.length];
			imageData.push({ filename: image.name, aspectRatio: image.width / image.height, image: image });
			imagesMap.set(image.name, image);
		}

		var options = {
			onClickHandler: function (filename) {
				debug('onClickHandler', filename);
				activeImage = imagesMap.get(filename);
				if (activeImage) {
					openActiveImage();
				}
			},
			containerId: galleryId,
			classPrefix: 'gd',
			spaceBetweenImages: 1,
			urlForSize: function (filename, size) {
				let img = imagesMap.get(filename);
				return img[size] || img['500'] || img.full; // Fallback if the requested size doesn’t exist
			},
			styleForElement: function (filename) {
				let image = imagesMap.get(filename);
				if (!image || image.colors.size < 1) {
					return '';
				}
				let colors = image.colors;
				let first = colors[0];
				let second = '#ccc';
				// Some images have only one dominant color.
				if (colors.length > 1) {
					second = colors[1];
				}

				return ` background: linear-gradient(15deg, ${first}, ${second});`;
			},
		};

		new Pig(imageData, options).enable();

		const handleUrlChange = () => {
			isNavigatingThroughHistory = true;
			const urlParams = new URLSearchParams(window.location.search);
			const imageHash = urlParams.get('image');
			if (imageHash) {
				const fullImageName = `img/${imageHash}.jpeg`;
				if (imagesMap.has(fullImageName)) {
					activeImage = imagesMap.get(fullImageName);
					openActiveImage();
				} else {
					closeModal();
				}
			} else {
				closeModal();
			}
			isNavigatingThroughHistory = false;
		};

		// Call handleUrlChange to handle initial URL
		handleUrlChange();

		// Add event listener for popstate
		window.addEventListener('popstate', function(event) {
			handleUrlChange();
		});
	},
};

export default GalleryDeluxe;
