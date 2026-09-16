# Ephemeris

A lightweight Python + Flask application for sketching and visualizing trajectories on top of real astronomical survey images using Aladin Lite.

The application serves an interactive sky map in the browser, allowing the user to:

* Explore astronomical images from professional sky surveys.
* Add points manually using celestial coordinates (RA/Dec).
* Add points directly by clicking on the sky.
* Draw and update trajectory polylines dynamically.
* Store and retrieve trajectories through a simple Flask API.
* Inspect the coordinates of trajectory points for later identification in astronomical catalogs.

## Requirements

* Python 3.10+
* Flask

Install dependencies:

```bash
pip install -r requirements.txt
```

## Running

```bash
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

## Controls

* **Click on the sky** to add a point to the trajectory.
* **Enter RA/Dec values** and click **Add Point** to insert coordinates manually.
* **Clear** removes all trajectory points.
* The current trajectory is displayed as a polyline overlay.

## Future Development

Possible extensions include:

* Integration with SIMBAD and VizieR catalogs.
* Automatic identification of stars, galaxies, and deep-sky objects near the trajectory.
* Import/export of trajectories as CSV, JSON, or ephemeris files.
* Animated trajectories.
* Multiple overlay layers.
* Real-time data sources and telescope control.

## Technologies

* Flask
* Aladin Lite
* DSS2 Sky Survey imagery

## Credits

Built on the Aladin Lite framework developed by CDS (Centre de Données astronomiques de Strasbourg).

---

## [ToDo](https://trello.com/c/THp6KcNP/63-ephemeris)
