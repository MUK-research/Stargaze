from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

trajectory = []

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/trajectory", methods=["GET", "POST", "DELETE"])
def api_trajectory():
    global trajectory

    if request.method == "POST":
        point = request.json
        trajectory.append({
            "ra": float(point["ra"]),
            "dec": float(point["dec"])
        })
        return jsonify(trajectory)

    if request.method == "DELETE":
        trajectory = []
        return jsonify(trajectory)

    return jsonify(trajectory)

if __name__ == "__main__":
    app.run(debug=True)